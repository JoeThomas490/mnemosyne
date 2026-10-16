// `list [filter]`: the Library's Clips, one line each, so the owner can find
// the one to remove.
import type { Clip } from "../../shared/index.ts";
import type { Bucket } from "./adapters.ts";
import { clipPath, loadManifest } from "./published-manifest.ts";

// One line per Clip, in manifest order: its relative path, Recording time and
// duration, in aligned columns. Given a filter, only the Clips whose path or
// Recording time (as shown) contains it, ignoring case.
export async function list(web: Bucket, filter = ""): Promise<string[]> {
  const { clips } = await loadManifest(web);
  const needle = filter.toLowerCase();
  const rows = clips
    .map((clip) => [clipPath(clip), formatRecordingTime(clip), formatDuration(clip.duration)])
    .filter(([path, recordingTime]) => `${path}\n${recordingTime}`.toLowerCase().includes(needle));
  const widths = [0, 1, 2].map((column) => Math.max(0, ...rows.map((row) => row[column]!.length)));
  return rows.map(([path, recordingTime, duration]) =>
    [path!.padEnd(widths[0]!), recordingTime!.padEnd(widths[1]!), duration!.padStart(widths[2]!)].join("  "),
  );
}

// "2026-04-04T14:17:16" as "2026-04-04 14:17:16".
export function formatRecordingTime(clip: Clip): string {
  return clip.recordingTime?.replace("T", " ") ?? "(no Recording time)";
}

// Seconds as m:ss, or h:mm:ss from an hour up.
function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const [h, m, s] = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
