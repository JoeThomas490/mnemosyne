// The Library CLI's view of the outside world. Ingest only talks to storage
// and the encoder through these, so it can run against in-memory fakes.

// One R2 bucket (`mnemosyne-originals` or `mnemosyne-web`).
export interface Bucket {
  has(key: string): Promise<boolean>;
  // Uploads the file at `path` (streamed; Originals can be large).
  upload(key: string, path: string, contentType: string): Promise<void>;
  // Downloads the object to `path`; throws if it doesn't exist.
  download(key: string, path: string): Promise<void>;
  // The object as text, or null if it doesn't exist.
  readText(key: string): Promise<string | null>;
  writeText(key: string, text: string, contentType: string): Promise<void>;
}

// Produces a web encode of an Original.
export interface Encoder {
  // Encodes the Original at `input` to `output`, returning the web encode's
  // duration in seconds.
  encode(input: string, output: string): Promise<{ duration: number }>;
}

export interface Log {
  info(message: string): void;
  warn(message: string): void;
}
