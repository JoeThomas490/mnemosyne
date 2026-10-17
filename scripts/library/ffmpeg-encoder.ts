// The web encode, made by shelling out to ffmpeg/ffprobe.
//
// The Originals are PAL 720×576 anamorphic 16:9 (SAR 64:45), interlaced
// top-field-first at 25 fps, MPEG-2 with AC-3 audio, neither of which plays
// in Chrome or Firefox.
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { EncodeProgress, Encoder } from "./adapters.ts";

// Bump whenever the encode settings below change. The next ingest then
// re-encodes every Clip from its archived Original under the new version's
// keys (ADR 0003).
export const ENCODE_VERSION = 1;

const run = promisify(execFile);

const FFMPEG_ARGS = [
  // Deinterlace each field into its own frame (25i → 50p) and square the
  // pixels: 720×576 at SAR 64:45 is 1024×576.
  ["-vf", "bwdif=mode=send_field:parity=auto,scale=1024:576,setsar=1"],
  ["-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "21", "-preset", "medium"],
  // A keyframe every 2s so Tuning in mid-Clip seeks quickly.
  ["-force_key_frames", "expr:gte(t,n_forced*2)"],
  ["-c:a", "aac", "-b:a", "128k", "-ac", "2"],
  // Index at the front so playback can start before the whole file arrives.
  ["-movflags", "+faststart"],
].flat();

export class FfmpegEncoder implements Encoder {
  async encode(
    input: string,
    output: string,
    onProgress?: (progress: EncodeProgress) => void,
  ): Promise<{ duration: number }> {
    // Camcorder MPEG-PS durations aren't always readable; progress then
    // reports only how much has been encoded.
    const total = await probeDuration(input).catch(() => null);
    await runFfmpeg(
      ["-nostdin", "-v", "error", "-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", ...FFMPEG_ARGS, output],
      (encoded) => onProgress?.({ encoded, total }),
    );
    return { duration: await probeDuration(output) };
  }
}

// The seconds encoded so far, from one line of ffmpeg's `-progress` output,
// or null if the line doesn't say.
export function encodedSecondsFrom(line: string): number | null {
  const match = line.match(/^out_time_us=(\d+)$/);
  return match ? Number(match[1]) / 1_000_000 : null;
}

// Runs ffmpeg with `-progress` on stdout, passing each report of the
// seconds encoded so far to `onEncoded`.
function runFfmpeg(args: string[], onEncoded: (seconds: number) => void): Promise<void> {
  const ffmpeg = spawn("ffmpeg", ["-progress", "pipe:1", "-nostats", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  createInterface({ input: ffmpeg.stdout }).on("line", (line) => {
    const seconds = encodedSecondsFrom(line);
    if (seconds !== null) onEncoded(seconds);
  });
  let stderr = "";
  ffmpeg.stderr.on("data", (chunk) => (stderr += chunk));
  return new Promise((resolve, reject) => {
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

// A media file's duration in seconds, per ffprobe.
async function probeDuration(path: string): Promise<number> {
  const { stdout } = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`ffprobe reported an unusable duration for ${path}: "${stdout.trim()}"`);
  }
  return duration;
}
