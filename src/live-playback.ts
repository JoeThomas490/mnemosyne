// The Live Playback Controller: the player's decision core. Given the
// Channel, the manifest, the clock and what the player reports, it decides
// what the player should do. It does no I/O and never reads the clock
// itself.
import { airingAt, type Airing, type Clip, type Manifest } from "../shared/index.ts";
import { channelClips, type Channel } from "./channels.ts";

export type PlayerEvent =
  | {
      type: "manifestFetched";
      manifest: Manifest;
      // The server's time when it answered, from the response's Date header.
      serverDate: number;
      // Local time when the request was sent.
      requestedAt: number;
    }
  // Sent regularly while the page is open; drives everything time-based.
  | { type: "tick" }
  // The manifest couldn't be fetched.
  | { type: "manifestFailed" }
  // The airing Clip played to its end.
  | { type: "clipEnded" }
  // Playback of the airing Clip resumed after stalling, at `position`
  // seconds in.
  | { type: "stallCleared"; position: number }
  // The Clip (airing or preloaded) couldn't be loaded.
  | { type: "clipFailed"; clipId: string };

export type Command =
  | { type: "fetchManifest" }
  // Cut to `clip`, `offset` seconds in.
  | { type: "air"; clip: Clip; offset: number }
  // Get `clip` ready to air from its start, so the cut to it is instant.
  | { type: "preload"; clip: Clip }
  // Seek the airing Clip to `offset` seconds, where the Schedule now is.
  | { type: "snapToLive"; offset: number }
  // Show the NO SIGNAL screen instead of a Clip.
  | { type: "noSignal" };

// How far behind (or ahead of) the Schedule playback may be after a stall
// before it snaps back to live, in seconds.
const MAX_DRIFT_SECONDS = 2;

// How long to wait before retrying the manifest while nothing can air, in
// milliseconds.
const RETRY_INTERVAL_MS = 30_000;

export class LivePlaybackController {
  // The Channel Tuned in to.
  private channel: Channel | null = null;
  private manifest: Manifest | null = null;
  // The slot on air (whether its Clip is showing or it was skipped), or null
  // while there's NO SIGNAL for want of a usable manifest, or of Clips on
  // the Channel.
  private airing: Airing | null = null;
  // The slot after `airing`, whose Clip the player was last asked to preload.
  private preloaded: Airing | null = null;
  // Start times of the slots whose Clip failed to load for this viewer.
  private failedSlots = new Set<number>();
  // Server time minus local time, in milliseconds.
  private clockOffset = 0;
  private fetching = false;
  // Local time at which to retry the manifest while off air.
  private retryAt = Infinity;

  // Tunes in to `channel` at `now` (the local clock): the first thing the
  // player does, and how it switches Channel. A switch airs the new
  // Channel's live Airing straight away from the manifest and clock
  // correction already in hand.
  tuneIn(channel: Channel, now: number): Command[] {
    this.channel = channel;
    // Slots are the old Channel's; the new one's are tried afresh.
    this.failedSlots.clear();
    if (!this.manifest) return this.fetchManifest();
    return this.applyManifest(now);
  }

  // `now` is the local clock, in milliseconds since the Unix epoch.
  handle(event: PlayerEvent, now: number): Command[] {
    switch (event.type) {
      case "manifestFetched": {
        this.fetching = false;
        // The server answered somewhere during the request; assume halfway.
        this.clockOffset = event.serverDate - (event.requestedAt + now) / 2;
        const unchanged = this.manifest && sameManifest(this.manifest, event.manifest);
        this.manifest = event.manifest;
        // An unchanged Library leaves the Schedule, and so playback, as it
        // is. Re-deriving here instead could land back in the slot just
        // cut away from, when the Clip ended a touch early or the new clock
        // correction is a little behind the last.
        if (unchanged && this.airing) return [];
        return this.applyManifest(now);
      }
      case "manifestFailed":
        this.fetching = false;
        // Without a manifest there's nothing to air; with one, keep airing
        // its Schedule and try again at the next boundary.
        return this.airing ? [] : this.offAir(now);
      case "tick":
        if (!this.airing) return now >= this.retryAt ? this.fetchManifest() : [];
        return this.atBoundary(now + this.clockOffset);
      case "clipEnded":
        // Encodes can run a touch short of their stated duration: the Clip
        // ending means its slot is over, whatever the clock says.
        return this.atBoundary(Math.max(now + this.clockOffset, this.airing?.end ?? -Infinity));
      case "stallCleared":
        return this.afterStall(event.position, now + this.clockOffset);
      case "clipFailed":
        return this.skip(event.clipId);
    }
  }

  // At a Clip boundary, re-derive what's on from the clock (rather than
  // just playing the next Clip) and pick up any Library changes.
  private atBoundary(live: number): Command[] {
    if (!this.airing || live < this.airing.end) return [];
    return [...this.airLive(live), ...this.fetchManifest()];
  }

  private afterStall(position: number, live: number): Command[] {
    if (!this.airing) return [];
    if (live >= this.airing.end) return this.atBoundary(live);
    const offset = (live - this.airing.start) / 1000;
    return Math.abs(offset - position) > MAX_DRIFT_SECONDS ? [{ type: "snapToLive", offset }] : [];
  }

  // Skips a Clip that failed to load for the rest of its slot, keeping to
  // the Schedule rather than jumping ahead of everyone else.
  private skip(clipId: string): Command[] {
    if (!this.airing) return [];
    if (this.airing.clip.id === clipId) {
      this.failedSlots.add(this.airing.start);
      return [{ type: "noSignal" }];
    }
    if (this.preloaded?.clip.id === clipId) this.failedSlots.add(this.preloaded.start);
    return [];
  }

  // Airs whatever the Schedule says is on, with a freshly fetched manifest.
  private applyManifest(now: number): Command[] {
    const live = now + this.clockOffset;
    const airing = this.channelAiringAt(live);
    if (!airing) return this.offAir(now);
    return this.airLive(live);
  }

  private airLive(live: number): Command[] {
    const airing = this.channelAiringAt(live)!;
    this.airing = airing;
    for (const start of this.failedSlots) if (start < airing.start) this.failedSlots.delete(start);

    return [
      this.failedSlots.has(airing.start)
        ? { type: "noSignal" }
        : { type: "air", clip: airing.clip, offset: (live - airing.start) / 1000 },
      ...this.preload(this.nextAiring(airing)),
    ];
  }

  private preload(next: Airing): Command[] {
    this.preloaded = next;
    return this.failedSlots.has(next.start) ? [] : [{ type: "preload", clip: next.clip }];
  }

  private offAir(now: number): Command[] {
    this.airing = null;
    this.retryAt = now + RETRY_INTERVAL_MS;
    return [{ type: "noSignal" }];
  }

  private fetchManifest(): Command[] {
    if (this.fetching) return [];
    this.fetching = true;
    return [{ type: "fetchManifest" }];
  }

  // The Airing on at `live` on the Channel's Schedule, from the current
  // manifest.
  private channelAiringAt(live: number): Airing | null {
    const manifest = this.manifest!;
    const channel = this.channel!;
    return airingAt(channelClips(channel, manifest.clips), channel.order, Date.parse(manifest.scheduleEpoch), live);
  }

  private nextAiring(airing: Airing): Airing {
    return this.channelAiringAt(airing.end)!;
  }
}

function sameManifest(a: Manifest, b: Manifest): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
