// The Library CLI's view of the outside world. Its commands only talk to
// storage and the encoder through these, so they can run against in-memory
// fakes.

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
  // Deletes the object; does nothing if it doesn't exist.
  delete(key: string): Promise<void>;
}

// How far an encode has got: seconds of the Original encoded so far, out of
// its total duration (null when that couldn't be read).
export interface EncodeProgress {
  encoded: number;
  total: number | null;
}

// Produces a web encode of an Original.
export interface Encoder {
  // Encodes the Original at `input` to `output`, returning the web encode's
  // duration in seconds. Reports progress to `onProgress` as it goes.
  encode(
    input: string,
    output: string,
    onProgress?: (progress: EncodeProgress) => void,
  ): Promise<{ duration: number }>;
}

export interface Log {
  info(message: string): void;
  warn(message: string): void;
  // A transient line saying what's happening now, replaced by the next one.
  status(text: string): void;
}
