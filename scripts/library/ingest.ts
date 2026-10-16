// `ingest <folder>` (ADR 0003): turns a folder of Originals into Library
// Clips.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MANIFEST_FORMAT_VERSION,
  MANIFEST_KEY,
  type Clip,
  type Manifest,
} from "../../shared/index.ts";
import type { Bucket, Encoder, Log } from "./adapters.ts";

export interface IngestOptions {
  originals: Bucket;
  web: Bucket;
  encoder: Encoder;
  log: Log;
  encodeVersion: number;
}

// The Schedule epoch given to a brand-new Library (ADR 0001).
const SCHEDULE_EPOCH = "2026-01-01T00:00:00Z";

export interface IngestResult {
  added: number;
  reencoded: number;
  // Relative paths of Originals (or Clips, when re-encoding) that couldn't be
  // processed. Everything else is still published.
  failed: string[];
}

export async function ingest(root: string, options: IngestOptions): Promise<IngestResult> {
  const { originals, web, encoder, log, encodeVersion } = options;
  const manifest = await loadManifest(web);
  // An older checkout of this CLI must not "re-encode" the Library back down.
  const newest = Math.max(0, ...manifest.clips.map((clip) => encodeVersionOf(clip.webEncodeKey)));
  if (newest > encodeVersion) {
    throw new Error(
      `the Library is encoded at encode version ${newest}, newer than this CLI's ${encodeVersion}`,
    );
  }
  const library = new Map(manifest.clips.map((clip) => [clip.id, clip]));
  const result: IngestResult = { added: 0, reencoded: 0, failed: [] };

  const scratch = await mkdtemp(join(tmpdir(), "mnemosyne-encode-"));
  // Encodes the Original at `path` and uploads it under this encode version.
  const encodeAndUpload = async (id: string, path: string) => {
    const webEncodeKey = webEncodeKeyFor(encodeVersion, id);
    const encoded = join(scratch, `${id}.mp4`);
    const { duration } = await encoder.encode(path, encoded);
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
    for (const clip of manifest.clips) {
      if (clip.webEncodeKey === webEncodeKeyFor(encodeVersion, clip.id)) continue;
      const clipPath = relativePath(clip.folder, clip.originalFilename);
      try {
        log.info(`re-encoding ${clipPath}`);
        const archived = join(scratch, clip.id);
        await originals.download(clip.id, archived);
        Object.assign(clip, await encodeAndUpload(clip.id, archived));
        await rm(archived, { force: true });
        result.reencoded++;
      } catch (error) {
        fail(clipPath, error);
      }
    }

    for (const original of await findOriginals(root)) {
      const originalPath = relativePath(original.folder, original.filename);
      try {
        const file = join(root, originalPath);
        const id = await contentHash(file);
        const existing = library.get(id);
        if (existing) {
          const clipPath = relativePath(existing.folder, existing.originalFilename);
          if (originalPath !== clipPath) {
            log.warn(
              `skipping ${originalPath}: same content as ${clipPath}, which is already in the Library`,
            );
          }
          continue;
        }

        log.info(`adding ${originalPath}`);
        // An interrupted run may already have archived it.
        if (!(await originals.has(id))) await originals.upload(id, file, "video/mpeg");
        const clip: Clip = {
          id,
          ...(await encodeAndUpload(id, file)),
          recordingTime: null,
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
    await web.writeText(MANIFEST_KEY, JSON.stringify(manifest, null, 2), "application/json");
  }
  return result;
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

// The published manifest, or an empty Library if none has been published.
async function loadManifest(web: Bucket): Promise<Manifest> {
  const text = await web.readText(MANIFEST_KEY);
  if (text === null) {
    return { formatVersion: MANIFEST_FORMAT_VERSION, scheduleEpoch: SCHEDULE_EPOCH, clips: [] };
  }
  const manifest: Manifest = JSON.parse(text);
  if (manifest.formatVersion !== MANIFEST_FORMAT_VERSION) {
    throw new Error(
      `the published manifest has format version ${manifest.formatVersion}; ` +
        `this CLI understands ${MANIFEST_FORMAT_VERSION}`,
    );
  }
  return manifest;
}

interface FoundOriginal {
  // Relative to the ingest root, with "/" separators ("" for the root).
  folder: string;
  filename: string;
}

// Every Original (.MPG file) under `root`, depth-first in name order, so
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

// An Original's path relative to the ingest root.
function relativePath(folder: string, filename: string): string {
  return folder ? `${folder}/${filename}` : filename;
}

async function contentHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
