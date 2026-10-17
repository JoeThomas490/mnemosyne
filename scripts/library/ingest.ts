// `ingest [folder]` (ADR 0003, ADR 0006): turns a folder of Originals under
// the Library root into Library Clips.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Clip } from "../../shared/index.ts";
import type { Bucket, EncodeProgress, Encoder, Log } from "./adapters.ts";
import { clipPath, loadManifest, publishManifest, relativePath } from "./published-manifest.ts";
import { readRecordingTime } from "./recording-time.ts";

export interface IngestOptions {
  originals: Bucket;
  web: Bucket;
  encoder: Encoder;
  log: Log;
  encodeVersion: number;
  // The folder to ingest: absolute, or relative to the Library root. Absent
  // means the whole Library root.
  path?: string;
}

export interface IngestResult {
  added: number;
  reencoded: number;
  // Originals whose content is already in the Library.
  skipped: number;
  // Relative paths of Originals (or Clips, when re-encoding) that couldn't be
  // processed. Everything else is still published.
  failed: string[];
}

// `root` is the Library root (ADR 0006): every Clip's folder is recorded
// relative to it, whichever folder under it is ingested. It comes from the
// LIBRARY_ROOT setting, so it may be unset.
export async function ingest(root: string | undefined, options: IngestOptions): Promise<IngestResult> {
  const { originals, web, encoder, log, encodeVersion } = options;
  if (!root) throw new Error("LIBRARY_ROOT is not set: set it in .env to the folder holding the Library's Originals");
  const start = folderUnderRoot(root, options.path);
  if (!(await stat(join(root, start)).catch(() => null))?.isDirectory()) {
    throw new Error(`not a folder: ${resolve(root, start)}`);
  }
  const manifest = await loadManifest(web);
  // An older checkout of this CLI must not "re-encode" the Library back down.
  const newest = Math.max(0, ...manifest.clips.map((clip) => encodeVersionOf(clip.webEncodeKey)));
  if (newest > encodeVersion) {
    throw new Error(
      `the Library is encoded at encode version ${newest}, newer than this CLI's ${encodeVersion}`,
    );
  }
  const library = new Map(manifest.clips.map((clip) => [clip.id, clip]));
  const result: IngestResult = { added: 0, reencoded: 0, skipped: 0, failed: [] };

  const scratch = await mkdtemp(join(tmpdir(), "mnemosyne-encode-"));
  // Encodes the Original at `path` and uploads it under this encode version,
  // showing the encode's progress after `label`.
  const encodeAndUpload = async (id: string, path: string, label: string) => {
    const webEncodeKey = webEncodeKeyFor(encodeVersion, id);
    const encoded = join(scratch, `${id}.mp4`);
    let shown = "";
    const { duration } = await encoder.encode(path, encoded, (progress) => {
      const text = `${label} ${formatProgress(progress)}`;
      if (text === shown) return;
      shown = text;
      log.status(text);
    });
    await web.upload(webEncodeKey, encoded, "video/mp4");
    await rm(encoded, { force: true });
    return { webEncodeKey, duration };
  };
  const fail = (path: string, error: unknown) => {
    log.warn(`failed on ${path}: ${error instanceof Error ? error.message : String(error)}`);
    result.failed.push(path);
  };

  try {
    // Clips encoded under an older encode version are re-encoded from their
    // archived Originals, which needn't be available locally.
    const stale = manifest.clips.filter((clip) => clip.webEncodeKey !== webEncodeKeyFor(encodeVersion, clip.id));
    for (const [i, clip] of stale.entries()) {
      const counter = `[re-encode ${i + 1}/${stale.length}]`;
      try {
        log.info(`${counter} re-encoding ${clipPath(clip)}`);
        const archived = join(scratch, clip.id);
        await originals.download(clip.id, archived);
        Object.assign(clip, await encodeAndUpload(clip.id, archived, `${counter} encoding ${clipPath(clip)}`));
        await rm(archived, { force: true });
        result.reencoded++;
      } catch (error) {
        fail(clipPath(clip), error);
      }
    }

    const found = await findOriginals(root, start);
    for (const [i, original] of found.entries()) {
      const originalPath = relativePath(original.folder, original.filename);
      const counter = `[${i + 1}/${found.length}]`;
      try {
        const file = join(root, originalPath);
        const id = await contentHash(file);
        const existing = library.get(id);
        if (existing) {
          if (originalPath !== clipPath(existing)) {
            log.warn(
              `skipping ${originalPath}: same content as ${clipPath(existing)}, which is already in the Library`,
            );
          }
          result.skipped++;
          continue;
        }

        log.info(`${counter} adding ${originalPath}`);
        const recordingTimeResult = await readRecordingTime(file);
        if (recordingTimeResult.recordingTime === null) {
          log.warn(`no Recording time for ${originalPath}: ${recordingTimeResult.problem}`);
        }
        // An interrupted run may already have archived it.
        if (!(await originals.has(id))) await originals.upload(id, file, "video/mpeg");
        const clip: Clip = {
          id,
          ...(await encodeAndUpload(id, file, `${counter} encoding ${originalPath}`)),
          recordingTime: recordingTimeResult.recordingTime,
          folder: original.folder,
          originalFilename: original.filename,
        };
        manifest.clips.push(clip);
        library.set(id, clip);
        result.added++;
      } catch (error) {
        fail(originalPath, error);
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  if (result.added + result.reencoded > 0) {
    await publishManifest(web, manifest);
  }
  return result;
}

// An encode's progress as a whole-number percentage or, when the Original's
// duration is unknown, as whole minutes and seconds encoded ("02:31"). The
// Original's duration is an estimate, so encoding can overrun it.
function formatProgress({ encoded, total }: EncodeProgress): string {
  if (total !== null) return `${Math.min(100, Math.floor((encoded / total) * 100))}%`;
  const seconds = Math.floor(encoded);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
}

// Where a Clip's web encode lives in the `mnemosyne-web` bucket (ADR 0003).
function webEncodeKeyFor(encodeVersion: number, id: string): string {
  return `v${encodeVersion}/${id}.mp4`;
}

// The encode version a web encode key was made under.
function encodeVersionOf(webEncodeKey: string): number {
  const match = webEncodeKey.match(/^v(\d+)\//);
  if (!match) throw new Error(`unrecognised web encode key: ${webEncodeKey}`);
  return Number(match[1]);
}

// The folder `path` names, relative to the Library root with "/"
// separators ("" for the root itself).
// Refuses a path outside the root, where folders would be meaningless.
function folderUnderRoot(root: string, path = ""): string {
  const folder = relative(resolve(root), resolve(root, path));
  if (folder === ".." || folder.startsWith(`..${sep}`) || isAbsolute(folder)) {
    throw new Error(`${resolve(root, path)} is outside the Library root (LIBRARY_ROOT, ${resolve(root)})`);
  }
  return folder.split(sep).join("/");
}

interface FoundOriginal {
  // Relative to the Library root, with "/" separators ("" for the root).
  folder: string;
  filename: string;
}

// Every Original (.MPG file) under `folder` of `root`, depth-first in name order, so
// which of two identical Originals counts as "first" is stable across runs.
// Hidden entries (.DS_Store, macOS "._" resource forks) are skipped.
async function findOriginals(root: string, folder = ""): Promise<FoundOriginal[]> {
  const entries = await readdir(join(root, folder), { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const found: FoundOriginal[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      found.push(...(await findOriginals(root, folder ? `${folder}/${entry.name}` : entry.name)));
    } else if (entry.isFile() && /\.mpg$/i.test(entry.name)) {
      found.push({ folder, filename: entry.name });
    }
  }
  return found;
}

async function contentHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
