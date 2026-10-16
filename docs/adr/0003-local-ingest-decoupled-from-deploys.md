# Library ingest runs locally and is decoupled from site deploys

Originals live on the owner's Mac and transcoding is CPU-heavy, so ingest is a local CLI (`npm run ingest <folder>`) rather than part of the Pages build or a cloud pipeline. It is add-only and idempotent by content hash: it archives each new Original to the `originals` bucket, encodes it to `web/v<encodeVersion>/<hash>.mp4`, and republishes `manifest.json`. The manifest lives in R2, not the site bundle, so adding Clips never requires a deploy and a deploy never touches the Library.

## Consequences

- Removing a Clip is explicit (`library:remove`), never inferred from a missing local file, so a disconnected drive can't wipe the Library.
- Changing encode settings means bumping the encode version and re-encoding from the archived Originals.
