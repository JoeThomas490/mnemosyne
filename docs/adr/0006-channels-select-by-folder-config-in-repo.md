# Channels select Clips by folder under a fixed Library root, and are defined in the repo

A Channel is an entry in `channels.json`, committed to the repo and bundled into the site. It picks its Clips by `include`: folders matched along with everything below them, with no `include` meaning the whole Library. A Clip's `folder` used to be relative to whichever folder `ingest` was pointed at, so the same footage could get `"Malta"` or `""` depending on where ingest was run, and Channels would empty without any warning. Now the Library CLI takes a fixed `LIBRARY_ROOT` from `.env`. `ingest` refuses paths outside it and records `folder` relative to it, so the convention is enforced rather than remembered.

## Considered Options

- **Channel config in R2 next to the manifest, or inside it**: changing a Channel would need no deploy, matching ADR 0003. Rejected because Channels are curation that changes rarely, while the Library changes often. In the repo they're reviewable, versioned and deployed by CI on push (ADR 0005).
- **Tags given at ingest**: independent of disk layout, but they need upkeep, and ingest skips Clips it already has, so a separate tagging command would be needed.
- **Recording-time ranges**: come from the footage itself and suit holidays and events, but Clips with no Recording time drop out and a wrong camcorder clock misfiles them. This could be added later as another kind of `include`.
- **Explicit Clip lists**: full curation, but tedious, and still tied to paths.

## Consequences

- Clips ingested before `LIBRARY_ROOT` keep `folder: ""`, so they only appear in Channels with no `include` (All) until they're re-ingested.
- Moving or renaming folders on disk leaves stale `folder` values: re-ingesting skips content it already has without updating it.
- A Channel can name a folder the Library doesn't have yet. It's still listed in the Channel Guide and airs NO SIGNAL.
