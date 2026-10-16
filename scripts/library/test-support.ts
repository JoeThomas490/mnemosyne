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
export async function folderOf(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mnemosyne-ingest-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}
