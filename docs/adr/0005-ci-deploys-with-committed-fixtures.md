# The site deploys from CI, and tests use committed camcorder fixtures

Every push to `main` runs a GitHub Action (`.github/workflows/deploy.yml`) that runs `npm run build` (typecheck, the full test suite, Vite build) and then `wrangler pages deploy` to the existing `mnemosyne` Direct Upload project. A failing typecheck or test stops the workflow before the deploy step. The Cloudflare credentials come only from the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. `npm run deploy` still works for manual deploys.

So the tests run on a fresh checkout, the Recording time decoder (ADR 0004) is tested against `scripts/library/fixtures/`: the first 64 packs (128 KiB) of three real Originals, cut at the byte level with `head -c 131072`, never re-muxed (ffmpeg can drop the private-stream-1 packets). Every pack is 2048 bytes and the first `ARI_DATA` packet sits in the second pack, so the slices keep the camcorder's pack structure and that packet byte for byte. The expected Recording times are those verified on the full Originals: 2026-04-04 14:17:16 (M2U00027), 2026-04-05 13:19:29 (M2U00036) and 2026-10-03 07:14:45 (M2U00265).

This revises issue #1, which put CI and committed sample Originals or fixture slices out of scope and ran tests only locally.

## Consequences

- The repo is public, so the fixtures publish about a quarter of a second of real footage each. The owner chose this over making the repo private or blanking the payloads.
- Full-size Originals in `assets/` stay git-ignored and are no longer needed to run the tests.
- Ingest stays local (ADR 0003); CI deploys the site, never the Library.
