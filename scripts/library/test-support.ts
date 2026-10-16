// Fakes for exercising the Library CLI at its seam.
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Bucket, Encoder, Log } from "./adapters.ts";

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

  text(key: string): string | undefined {
    return this.objects.get(key)?.bytes.toString("utf8");
  }
}

// "Encodes" an Original by tagging its content with the encoder's label, so
// tests can tell which Original (and which encoder) produced an encode. By
// default each encode lasts as many seconds as the Original has bytes.
export class FakeEncoder implements Encoder {
  encodes = 0;

  constructor(
    private readonly label = "web",
    private readonly durationOf = (original: string) => original.length,
  ) {}

  async encode(input: string, output: string): Promise<{ duration: number }> {
    const original = await readFile(input, "utf8");
    await writeFile(output, `${this.label}:${original}`);
    this.encodes++;
    return { duration: this.durationOf(original) };
  }
}

export class RecordingLog implements Log {
  readonly warnings: string[] = [];

  info(): void {}

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
