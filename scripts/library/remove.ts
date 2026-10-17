// `remove <target>` (ADR 0003): takes a Clip off air. Removal is always
// explicit, never inferred from a missing local Original.
import type { Clip } from "../../shared/index.ts";
import type { Bucket, Log } from "./adapters.ts";
import { clipPath, loadManifest, publishManifest } from "./published-manifest.ts";

export interface RemoveAllOptions {
  originals: Bucket;
  web: Bucket;
  log: Log;
  // Also delete the archived Originals. Without it, re-ingesting an Original
  // restores its Clip.
  purge: boolean;
}

export interface RemoveOptions extends RemoveAllOptions {
  // Asks the owner which of several Clips sharing a bare Original filename
  // to remove; null removes none.
  choose(matches: Clip[]): Promise<Clip | null>;
}

// Removes the Clip `target` names: either its exact path relative to the
// ingest root ("Malta/M2U00001.MPG") or, with no "/", a bare Original
// filename ("M2U00001.MPG"). A Clip at the ingest root can only be named by
// its bare filename, so it's offered alongside any same-named Clips in
// subfolders rather than removed directly. Returns the removed Clip, or null
// if the owner chose none.
export async function remove(target: string, options: RemoveOptions): Promise<Clip | null> {
  const { web, log, purge } = options;
  const manifest = await loadManifest(web);
  const matches = manifest.clips.filter((candidate) =>
    target.includes("/") ? clipPath(candidate) === target : candidate.originalFilename === target,
  );
  if (matches.length === 0) throw new Error(`no Clip matches ${target}`);
  const clip = matches.length === 1 ? matches[0]! : await options.choose(matches);
  if (!clip) return null;

  // Take it off air before deleting its encode, so nothing airs a missing
  // file.
  manifest.clips = manifest.clips.filter((candidate) => candidate !== clip);
  await publishManifest(web, manifest);
  await deleteFiles(clip, options);
  log.info(`removed ${clipPath(clip)}${purge ? ", and purged its archived Original" : ""}`);
  return clip;
}

// Takes every Clip off air, returning them.
export async function removeAll(options: RemoveAllOptions): Promise<Clip[]> {
  const { web, log, purge } = options;
  const manifest = await loadManifest(web);
  const clips = manifest.clips;
  if (clips.length === 0) return clips;

  // As with one Clip: off air first, then delete.
  manifest.clips = [];
  await publishManifest(web, manifest);
  for (const clip of clips) await deleteFiles(clip, options);
  const count = `${clips.length} Clip${clips.length === 1 ? "" : "s"}`;
  log.info(`removed ${count}${purge ? ", and purged their archived Originals" : ""}`);
  return clips;
}

// Deletes an off-air Clip's web encode, and with `purge` its archived
// Original.
async function deleteFiles(clip: Clip, { originals, web, purge }: RemoveAllOptions): Promise<void> {
  await web.delete(clip.webEncodeKey);
  if (purge) await originals.delete(clip.id);
}
