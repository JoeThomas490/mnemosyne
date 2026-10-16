# Recording time is decoded from Sony ARI_DATA packets

The Sony DCR-SX33E writes no `creation_time` metadata and no sidecar file, and file birth times are unreliable once files are copied. The camera does, however, embed private-stream-1 packets (`00 00 01 BD`, sub-stream `0xFF`) whose payload begins `ARI_DATA`, about twice a second. In the first one, the 5 bytes at payload offset `0xA3` hold the camera-clock time as a big-endian bit-field, least significant first: seconds (6 bits), minutes (6), hours (5), day (5), month (4), year (remaining bits). This is reverse-engineered, verified on three Originals in `assets/` against their file birth times.

## Consequences

- The time is camera-local wall time with no timezone; it is displayed as-is. The 2 bytes before it (`10 3C`) may be a timezone offset but are unconfirmed.
- A failed or implausible decode means the Clip has no Recording time (and no Date stamp), never a guessed one.
- The `assets/` Originals serve as test fixtures for the decoder.
