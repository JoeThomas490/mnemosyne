// `remove <target>` (ADR 0003): takes a Clip off air. Removal is always
// explicit, never inferred from a missing local Original.
import type { Clip } from "../../shared/index.ts";
import type { Bucket, Log } from "./adapters.ts";
import { clipPath, loadManifest, publishManifest } from "./published-manifest.ts";

export interface RemoveOptions {
  originals: Bucket;
  web: Bucket;
  log: Log;
  // Also delete the archived Original. Without it, re-ingesting the Original
  // restores the Clip.
  purge: boolean;
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
  const { originals, web, log, purge } = options;
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
  await web.delete(clip.webEncodeKey);
  if (purge) await originals.delete(clip.id);
  log.info(`removed ${clipPath(clip)}${purge ? ", and purged its archived Original" : ""}`);
  return clip;
}
