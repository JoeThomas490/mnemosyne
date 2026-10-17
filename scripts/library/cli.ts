// The Library CLI. Always works on the real (production) Library.
//
//   npm run ingest <folder>
//   npm run library:list [filter]
//   npm run library:remove -- <target> [--purge]
//   npm run library:remove -- --all [--purge]
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Clip } from "../../shared/index.ts";
import type { Log } from "./adapters.ts";
import { ENCODE_VERSION, FfmpegEncoder } from "./ffmpeg-encoder.ts";
import { ingest } from "./ingest.ts";
import { formatRecordingTime, list } from "./list.ts";
import { clipPath } from "./published-manifest.ts";
import { S3ApiBucket, r2ClientFromEnv } from "./r2-bucket.ts";
import { remove, removeAll } from "./remove.ts";

// Bucket names, as bound in wrangler.toml.
const ORIGINALS_BUCKET = "mnemosyne-originals";
const WEB_BUCKET = "mnemosyne-web";

const USAGE = [
  "usage: npm run ingest <folder>",
  "       npm run library:list [filter]",
  "       npm run library:remove -- <target> [--purge]",
  "       npm run library:remove -- --all [--purge]",
].join("\n");

// Status lines are redrawn in place on a terminal and left out otherwise;
// any other output clears the current one first.
let statusShown = false;
const clearStatus = () => {
  if (statusShown) process.stdout.write("\r\x1b[K");
  statusShown = false;
};
const log: Log = {
  info: (message) => {
    clearStatus();
    console.log(message);
  },
  warn: (message) => {
    clearStatus();
    console.warn(`warning: ${message}`);
  },
  status: (text) => {
    if (!process.stdout.isTTY) return;
    // Truncated to the terminal's width, or "\r" can't redraw it.
    process.stdout.write(`\r\x1b[K${text.slice(0, process.stdout.columns - 1)}`);
    statusShown = true;
  },
};

function buckets() {
  const client = r2ClientFromEnv();
  return {
    originals: new S3ApiBucket(client, ORIGINALS_BUCKET),
    web: new S3ApiBucket(client, WEB_BUCKET),
  };
}

async function main([command, ...args]: string[]): Promise<number> {
  switch (command) {
    case "ingest":
      if (args.length === 1) return runIngest(args[0]!);
      break;
    case "list":
      if (args.length <= 1) return runList(args[0]);
      break;
    case "remove": {
      const purge = args.includes("--purge");
      const targets = args.filter((arg) => arg !== "--purge");
      if (targets.length === 1 && targets[0] === "--all") return runRemoveAll(purge);
      if (targets.length === 1 && !targets[0]!.startsWith("-")) return runRemove(targets[0]!, purge);
      break;
    }
  }
  console.error(USAGE);
  return 2;
}

async function runIngest(folder: string): Promise<number> {
  const root = resolve(folder);
  if (!(await stat(root).catch(() => null))?.isDirectory()) {
    console.error(`not a folder: ${root}`);
    return 2;
  }

  const started = Date.now();
  const result = await ingest(root, {
    ...buckets(),
    encoder: new FfmpegEncoder(),
    log,
    encodeVersion: ENCODE_VERSION,
  });

  log.info(
    `added ${result.added}, re-encoded ${result.reencoded}, skipped ${result.skipped}, ` +
      `failed ${result.failed.length} in ${formatElapsed(Date.now() - started)}`,
  );
  return result.failed.length > 0 ? 1 : 0;
}

// "12s", "41m 7s" or "2h 3m".
function formatElapsed(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

async function runList(filter?: string): Promise<number> {
  const lines = await list(buckets().web, filter);
  for (const line of lines) console.log(line);
  console.log(`${lines.length} Clip${lines.length === 1 ? "" : "s"}`);
  return 0;
}

async function runRemove(target: string, purge: boolean): Promise<number> {
  const removed = await remove(target, { ...buckets(), log, purge, choose: askWhich });
  if (!removed) console.log("removed nothing");
  return 0;
}

async function runRemoveAll(purge: boolean): Promise<number> {
  const removed = await removeAll({ ...buckets(), log, purge });
  if (removed.length === 0) console.log("removed nothing");
  return 0;
}

// Asks the owner which of several Clips sharing an Original filename they
// mean.
async function askWhich(matches: Clip[]): Promise<Clip | null> {
  console.log("Several Clips' Originals have that filename:");
  matches.forEach((clip, i) => console.log(`  ${i + 1}. ${clipPath(clip)}  ${formatRecordingTime(clip)}`));
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await prompt.question(`Remove which? [1-${matches.length}, or blank for none] `)).trim();
      if (answer === "") return null;
      const choice = matches[Number(answer) - 1];
      if (/^\d+$/.test(answer) && choice) return choice;
    }
  } finally {
    prompt.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    clearStatus();
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
