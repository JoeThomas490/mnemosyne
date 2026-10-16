// The Date stamp's text: the Clip's Recording time advanced by how far
// into the Clip playback is, laid out like a Sony camcorder's.

// The Date stamp's two lines: the date, then the time.
export type DateStampLines = [string, string];

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// The Date stamp's two lines, e.g. ["APR 4 2026", "2:17:16 PM"], for a
// Clip with `recordingTime` (camera-local, no timezone, ADR 0004) that's
// `offset` seconds in; null when there's no Recording time.
export function dateStampLines(recordingTime: string | null, offset: number): DateStampLines | null {
  if (recordingTime === null) return null;
  // The time is wall-clock with no timezone: do the arithmetic in UTC so
  // no daylight-saving change can shift it.
  const start = Date.parse(`${recordingTime}Z`);
  if (Number.isNaN(start)) return null;
  const time = new Date(start + Math.floor(offset) * 1000);
  const hours = time.getUTCHours();
  const minutes = String(time.getUTCMinutes()).padStart(2, "0");
  const seconds = String(time.getUTCSeconds()).padStart(2, "0");
  return [
    `${MONTHS[time.getUTCMonth()]} ${time.getUTCDate()} ${time.getUTCFullYear()}`,
    `${hours % 12 || 12}:${minutes}:${seconds} ${hours < 12 ? "AM" : "PM"}`,
  ];
}
