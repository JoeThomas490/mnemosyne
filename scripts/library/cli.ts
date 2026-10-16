// The Library CLI. Always works on the real (production) Library.
//
//   npm run ingest <folder>
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Log } from "./adapters.ts";
import { ENCODE_VERSION, FfmpegEncoder } from "./ffmpeg-encoder.ts";
import { ingest } from "./ingest.ts";
import { S3ApiBucket, r2ClientFromEnv } from "./r2-bucket.ts";

// Bucket names, as bound in wrangler.toml.
const ORIGINALS_BUCKET = "mnemosyne-originals";
const WEB_BUCKET = "mnemosyne-web";

const log: Log = {
  info: (message) => console.log(message),
  warn: (message) => console.warn(`warning: ${message}`),
};

async function main([command, ...args]: string[]): Promise<number> {
  if (command !== "ingest" || args.length !== 1) {
    console.error("usage: npm run ingest <folder>");
    return 2;
  }
  const root = resolve(args[0]!);
  if (!(await stat(root).catch(() => null))?.isDirectory()) {
    console.error(`not a folder: ${root}`);
    return 2;
  }

  const client = r2ClientFromEnv();
  const result = await ingest(root, {
    originals: new S3ApiBucket(client, ORIGINALS_BUCKET),
    web: new S3ApiBucket(client, WEB_BUCKET),
    encoder: new FfmpegEncoder(),
    log,
    encodeVersion: ENCODE_VERSION,
  });

  console.log(`added ${result.added}, re-encoded ${result.reencoded}, failed ${result.failed.length}`);
  return result.failed.length > 0 ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
