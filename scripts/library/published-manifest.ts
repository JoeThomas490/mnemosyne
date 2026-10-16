// The manifest as the Library CLI reads and republishes it in the
// `mnemosyne-web` bucket.
import {
  MANIFEST_FORMAT_VERSION,
  MANIFEST_KEY,
  type Clip,
  type Manifest,
} from "../../shared/index.ts";
import type { Bucket } from "./adapters.ts";

// The Schedule epoch given to a brand-new Library (ADR 0001).
const SCHEDULE_EPOCH = "2026-01-01T00:00:00Z";

// The published manifest, or an empty Library if none has been published.
export async function loadManifest(web: Bucket): Promise<Manifest> {
  const text = await web.readText(MANIFEST_KEY);
  if (text === null) {
    return { formatVersion: MANIFEST_FORMAT_VERSION, scheduleEpoch: SCHEDULE_EPOCH, clips: [] };
  }
  const manifest: Manifest = JSON.parse(text);
  if (manifest.formatVersion !== MANIFEST_FORMAT_VERSION) {
    throw new Error(
      `the published manifest has format version ${manifest.formatVersion}; ` +
        `this CLI understands ${MANIFEST_FORMAT_VERSION}`,
    );
  }
  return manifest;
}

export async function publishManifest(web: Bucket, manifest: Manifest): Promise<void> {
  await web.writeText(MANIFEST_KEY, JSON.stringify(manifest, null, 2), "application/json");
}

// An Original's path relative to the ingest root.
export function relativePath(folder: string, filename: string): string {
  return folder ? `${folder}/${filename}` : filename;
}

// A Clip's Original's path relative to the ingest root.
export function clipPath(clip: Clip): string {
  return relativePath(clip.folder, clip.originalFilename);
}
