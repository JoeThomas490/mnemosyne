// Decodes an Original's Recording time from the Sony ARI_DATA packets the
// camcorder embeds in it (ADR 0004).
import { open } from "node:fs/promises";

// ARI_DATA packets come about twice a second, so the first one is near the
// start; this bounds the read on an Original that has none.
const SCAN_LIMIT = 8 * 1024 * 1024;

const PRIVATE_STREAM_1 = Buffer.from([0x00, 0x00, 0x01, 0xbd]);
const SUB_STREAM_ID = 0xff;
const ARI_DATA = Buffer.from("ARI_DATA", "ascii");
// Offset of the 5-byte time bit-field, counted from the start of the PES
// payload (the sub-stream ID byte).
const TIME_OFFSET = 0xa3;
const TIME_LENGTH = 5;

export type RecordingTimeResult =
  | { recordingTime: string }
  | { recordingTime: null; problem: string };

// The Recording time of the Original at `path` as a camera-local ISO 8601
// date-time with no timezone (e.g. "2026-04-04T14:17:16"), or null with the
// reason it couldn't be recovered. Never guesses.
export async function readRecordingTime(path: string): Promise<RecordingTimeResult> {
  const bytes = await readStart(path, SCAN_LIMIT);
  const field = findTimeField(bytes);
  if (!field) return { recordingTime: null, problem: "no ARI_DATA packet found" };
  return decodeTimeField(field);
}

async function readStart(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await file.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

// The time bit-field of the first private-stream-1 packet on sub-stream 0xFF
// whose payload is ARI_DATA.
function findTimeField(bytes: Buffer): Buffer | null {
  for (
    let start = bytes.indexOf(PRIVATE_STREAM_1);
    start !== -1;
    start = bytes.indexOf(PRIVATE_STREAM_1, start + 1)
  ) {
    // Start code (4), packet length (2), flags (2), header data length (1).
    const headerDataLength = bytes[start + 8];
    if (headerDataLength === undefined) return null;
    const payload = start + 9 + headerDataLength;
    if (
      bytes[payload] === SUB_STREAM_ID &&
      bytes.subarray(payload + 1, payload + 1 + ARI_DATA.length).equals(ARI_DATA)
    ) {
      const field = bytes.subarray(payload + TIME_OFFSET, payload + TIME_OFFSET + TIME_LENGTH);
      return field.length === TIME_LENGTH ? field : null;
    }
  }
  return null;
}

// Big-endian, least-significant field first: seconds (6 bits), minutes (6),
// hours (5), day (5), month (4), year (the rest).
function decodeTimeField(field: Buffer): RecordingTimeResult {
  let value = field.readUIntBE(0, TIME_LENGTH);
  const take = (bits: number) => {
    const part = value % 2 ** bits;
    value = Math.floor(value / 2 ** bits);
    return part;
  };
  const second = take(6);
  const minute = take(6);
  const hour = take(5);
  const day = take(5);
  const month = take(4);
  const year = value;

  const pad = (n: number) => String(n).padStart(2, "0");
  const decoded = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
  if (!isPlausible(year, month, day, hour, minute, second)) {
    return { recordingTime: null, problem: `implausible ARI_DATA time ${decoded}` };
  }
  return { recordingTime: decoded };
}

function isPlausible(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (year < 2000 || year > 2100) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth;
}
