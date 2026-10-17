// Fakes for exercising the Library CLI at its seam.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MANIFEST_KEY, type Clip, type Manifest } from "../../shared/index.ts";
import type { Bucket, EncodeProgress, Encoder, Log } from "./adapters.ts";
import { loadManifest, publishManifest } from "./published-manifest.ts";

// An in-memory bucket that records every write.
export class InMemoryBucket implements Bucket {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();
  writes = 0;

  async has(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async upload(key: string, path: string, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: await readFile(path), contentType });
    this.writes++;
  }

  async download(key: string, path: string): Promise<void> {
    const object = this.objects.get(key);
    if (!object) throw new Error(`no such object: ${key}`);
    await writeFile(path, object.bytes);
  }

  async readText(key: string): Promise<string | null> {
    return this.objects.get(key)?.bytes.toString("utf8") ?? null;
  }

  async writeText(key: string, text: string, contentType: string): Promise<void> {
    this.objects.set(key, { bytes: Buffer.from(text, "utf8"), contentType });
    this.writes++;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
    this.writes++;
  }

  text(key: string): string | undefined {
    return this.objects.get(key)?.bytes.toString("utf8");
  }
}

// "Encodes" an Original by tagging its content with the encoder's label, so
// tests can tell which Original (and which encoder) produced an encode. By
// default each encode lasts as many seconds as the Original has bytes.
export class FakeEncoder implements Encoder {
  encodes = 0;
  // Progress reported, in order, during every encode.
  reports: EncodeProgress[] = [];

  constructor(
    private readonly label = "web",
    private readonly durationOf = (original: string) => original.length,
  ) {}

  async encode(
    input: string,
    output: string,
    onProgress?: (progress: EncodeProgress) => void,
  ): Promise<{ duration: number }> {
    const original = await readFile(input, "utf8");
    for (const progress of this.reports) onProgress?.(progress);
    await writeFile(output, `${this.label}:${original}`);
    this.encodes++;
    return { duration: this.durationOf(original) };
  }
}

export class RecordingLog implements Log {
  readonly infos: string[] = [];
  readonly warnings: string[] = [];
  readonly statuses: string[] = [];

  status(text: string): void {
    this.statuses.push(text);
  }

  info(message: string): void {
    this.infos.push(message);
  }

  warn(message: string): void {
    this.warnings.push(message);
  }
}

// Creates a folder of fake Originals: { "relative/path.MPG": "content" }.
export async function folderOf(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mnemosyne-ingest-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

// A fake Original holding one Sony ARI_DATA packet (ADR 0004) that records
// the given camera-clock time, whether or not it's a real date.
export function originalRecordedAt(time: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): Buffer {
  // Most significant field first: year, month (4 bits), day (5), hour (5),
  // minute (6), second (6).
  let field = time.year;
  for (const [value, bits] of [
    [time.month, 4],
    [time.day, 5],
    [time.hour, 5],
    [time.minute, 6],
    [time.second, 6],
  ] as const) {
    field = field * 2 ** bits + value;
  }

  const payload = Buffer.alloc(0xa8);
  payload[0] = 0xff; // sub-stream ID
  payload.write("ARI_DATA", 1, "ascii");
  payload.writeUIntBE(field, 0xa3, 5);
  const header = Buffer.from([0x00, 0x00, 0x01, 0xbd, 0x00, 0x00, 0x81, 0x00, 0x00]);
  header.writeUInt16BE(3 + payload.length, 4);
  return Buffer.concat([header, payload]);
}

// A Clip already in the Library, whose Original was found at
// `folder/filename`. Its id is derived from that path, so it's stable and
// distinct per path.
export function clipIn(
  folder: string,
  filename: string,
  fields: Partial<Omit<Clip, "folder" | "originalFilename">> = {},
): Clip {
  const id = createHash("sha256").update(`${folder}/${filename}`).digest("hex");
  return {
    id,
    webEncodeKey: `v1/${id}.mp4`,
    duration: 60,
    recordingTime: null,
    folder,
    originalFilename: filename,
    ...fields,
  };
}

// Puts `clips` into a Library as ingest would have left it: a published
// manifest, each Clip's web encode in `web` and, given `originals`, each
// Clip's archived Original there.
export async function publishLibrary(
  web: InMemoryBucket,
  clips: Clip[],
  originals?: InMemoryBucket,
): Promise<void> {
  await publishManifest(web, { ...(await loadManifest(web)), clips });
  web.writes = 0;
  for (const clip of clips) {
    web.objects.set(clip.webEncodeKey, { bytes: Buffer.from("encode"), contentType: "video/mp4" });
    originals?.objects.set(clip.id, { bytes: Buffer.from("original"), contentType: "video/mpeg" });
  }
}

// The manifest last published to `web`.
export function readManifest(web: InMemoryBucket): Manifest {
  const text = web.text(MANIFEST_KEY);
  if (text === undefined) throw new Error("no manifest was published");
  return JSON.parse(text);
}
