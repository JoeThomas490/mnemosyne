// The web encode, made by shelling out to ffmpeg/ffprobe.
//
// The Originals are PAL 720×576 anamorphic 16:9 (SAR 64:45), interlaced
// top-field-first at 25 fps, MPEG-2 with AC-3 audio, neither of which plays
// in Chrome or Firefox.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Encoder } from "./adapters.ts";

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
  async encode(input: string, output: string): Promise<{ duration: number }> {
    await run(
      "ffmpeg",
      ["-nostdin", "-v", "error", "-y", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", ...FFMPEG_ARGS, output],
      { maxBuffer: 16 * 1024 * 1024 },
    );
    const { stdout } = await run("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      output,
    ]);
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`ffprobe reported an unusable duration for the web encode: "${stdout.trim()}"`);
    }
    return { duration };
  }
}
