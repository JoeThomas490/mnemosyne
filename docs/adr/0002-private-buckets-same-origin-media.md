# Private buckets behind a same-origin media route

The footage is personal, so both R2 buckets (`originals`, `web`) are private from the start. Media is served by a Pages Function at `/media/*` that reads from the bucket binding and handles HTTP Range requests, with an access-policy middleware (`open` / `password` / `access`) in front of both the page and the media. We chose this over presigned R2 URLs because it keeps one origin (no CORS, which the WebGL video texture would otherwise need), one place to change who can watch, and no URLs expiring mid-Clip.

## Consequences

- Every media byte passes through a Function. Fine at personal scale (billed per request, not bandwidth); if traffic grows, add edge caching or revisit presigned URLs.
