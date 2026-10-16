// The manifest describes the Library. The Library CLI publishes it to the
// `mnemosyne-web` bucket; the frontend fetches it through the media route.

// Object key of the manifest in the `mnemosyne-web` bucket (served at
// /media/<key>).
export const MANIFEST_KEY = "manifest.json";

// Bumped whenever the manifest's shape changes incompatibly.
export const MANIFEST_FORMAT_VERSION = 1;

export interface Manifest {
  formatVersion: typeof MANIFEST_FORMAT_VERSION;
  // The instant the Schedule counts from (ADR 0001), as an ISO 8601 UTC
  // date-time, e.g. "2026-01-01T00:00:00Z".
  scheduleEpoch: string;
  clips: Clip[];
}

export interface Clip {
  // Content hash of the Clip's Original; the Clip's identity.
  id: string;
  // Object key of the web encode in the `mnemosyne-web` bucket, e.g.
  // "v1/<id>.mp4".
  webEncodeKey: string;
  // Duration of the web encode (what actually airs), in seconds.
  duration: number;
  // Camera-local date-time with no timezone (ADR 0004), e.g.
  // "2026-04-04T14:17:16", or null when it couldn't be recovered.
  recordingTime: string | null;
  // Folder the Original was found in, relative to the ingest root
  // ("" for the root itself), using "/" separators.
  folder: string;
  // The Original's filename as it came off the camcorder, e.g. "M2U00027.MPG".
  originalFilename: string;
}
