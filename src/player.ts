// The player: two <video> elements double-buffered for hard cuts, shown
// through the CRT, a NO SIGNAL screen, and the plumbing between them and
// the Live Playback Controller. All scheduling decisions are the
// controller's; this only reports what happens and does as it's told.
// Sound is the viewer's to turn on, through the returned Player's sound.
import { MANIFEST_KEY, type Clip, type Manifest } from "../shared/index.ts";
import { startCrt } from "./crt.ts";
import { dateStampLines } from "./date-stamp.ts";
import type { Channel } from "./channels.ts";
import { LivePlaybackController, type Command, type PlayerEvent } from "./live-playback.ts";

// How often the controller is ticked, in milliseconds.
const TICK_INTERVAL_MS = 100;
// How far a preloaded Clip may be from where it should air before it's
// worth a seek (which costs a moment of loading), in seconds.
const SEEK_TOLERANCE_SECONDS = 0.25;

// The player's sound: one muted state shared by both elements, so it holds
// across Clip changes.
export interface PlayerSound {
  readonly muted: boolean;
  // Call from a user gesture when unmuting, as browsers only allow unmuted
  // playback that a viewer started.
  setMuted(muted: boolean): void;
  // Called whenever `muted` changes, including when a browser refuses
  // unmuted playback and the player falls back to muted.
  onChange(listener: (muted: boolean) => void): void;
}

// A running player.
export interface Player {
  sound: PlayerSound;
  // The Channel last Tuned in to: the one airing.
  readonly channel: Channel;
  // Switches to `channel`, live. Call from a user gesture, so the viewer's
  // sound setting carries over.
  tuneIn(channel: Channel): void;
  // Hides and mutes the picture without stopping it, so the Channel keeps
  // airing behind (say) the Channel Guide; unblanking restores the
  // viewer's sound setting.
  setBlanked(blanked: boolean): void;
}

export function startPlayer(screen: HTMLElement, channel: Channel): Player {
  const controller = new LivePlaybackController();
  const noSignal = document.createElement("div");
  noSignal.className = "no-signal";
  noSignal.textContent = "NO SIGNAL";
  // The videos sit (small) under the CRT's canvas rather than being
  // hidden, which some browsers (notably iOS Safari) would take as licence
  // to stop decoding them.
  const crt = document.createElement("canvas");
  crt.className = "crt";
  let active = createVideo();
  let standby = createVideo();
  screen.replaceChildren(active, standby, crt, noSignal);
  // The Clip each element holds.
  const clips = new Map<HTMLVideoElement, Clip>();
  // Whether the airing Clip is showing, rather than NO SIGNAL.
  let onAir = false;
  startCrt(crt, () => {
    if (!onAir) return null;
    const recordingTime = clips.get(active)?.recordingTime ?? null;
    return { video: active, dateStamp: dateStampLines(recordingTime, active.currentTime) };
  });
  // Browsers only autoplay muted video, so the viewer starts muted.
  let muted = true;
  // Hidden and muted, whatever the viewer's sound setting.
  let blanked = false;
  const mutedListeners: ((muted: boolean) => void)[] = [];
  // Set when the airing Clip is loading or stalled; its next `playing`
  // reports where playback resumed.
  let stalled = false;

  const send = (event: PlayerEvent) => run(controller.handle(event, Date.now()));

  function run(commands: Command[]): void {
    for (const command of commands) {
      switch (command.type) {
        case "fetchManifest":
          void fetchManifest().then(send);
          break;
        case "air":
          air(command.clip, command.offset);
          break;
        case "preload":
          load(standby, command.clip, 0);
          break;
        case "snapToLive":
          active.currentTime = command.offset;
          break;
        case "noSignal":
          active.pause();
          setOnAir(false);
          break;
      }
    }
  }

  function air(clip: Clip, offset: number): void {
    // Cut to the preloaded element when it holds this Clip; otherwise load
    // it there now.
    if (clips.get(standby)?.id !== clip.id) load(standby, clip, offset);
    else if (Math.abs(standby.currentTime - offset) > SEEK_TOLERANCE_SECONDS) standby.currentTime = offset;
    [active, standby] = [standby, active];
    standby.pause();
    stalled = true;
    const airing = active;
    airing.play().catch((error: unknown) => {
      // A browser that won't play this element unmuted (iOS Safari, for
      // one it was never unlocked for) can still play it muted.
      if (error instanceof DOMException && error.name === "NotAllowedError" && !muted) {
        setMuted(true);
        if (airing === active) void airing.play().catch(() => {});
      }
      // A load failure is reported through the element's error event.
    });
    setOnAir(true);
  }

  function setMuted(next: boolean): void {
    if (next === muted) return;
    muted = next;
    applySound();
    for (const listener of mutedListeners) listener(muted);
  }

  function setBlanked(next: boolean): void {
    if (next === blanked) return;
    blanked = next;
    screen.classList.toggle("blanked", blanked);
    applySound();
  }

  function applySound(): void {
    const silent = muted || blanked;
    for (const video of [active, standby]) {
      video.muted = silent;
      // Some browsers (iOS Safari) only let an element play unmuted once
      // it's been played from a gesture: unlock the standby element now,
      // as it'll next play from a tick.
      if (!silent && video === standby) {
        void video.play().catch(() => {});
        video.pause();
      }
    }
  }

  function load(video: HTMLVideoElement, clip: Clip, offset: number): void {
    // Re-setting the same src would refetch it for nothing.
    if (clips.get(video)?.id !== clip.id) {
      clips.set(video, clip);
      video.src = `/media/${clip.webEncodeKey}`;
    }
    video.currentTime = offset;
  }

  function setOnAir(on: boolean): void {
    onAir = on;
    noSignal.hidden = on;
  }

  function createVideo(): HTMLVideoElement {
    const video = document.createElement("video");
    // Muted to start with (see `muted`); playsInline keeps iOS from going
    // fullscreen.
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("ended", () => {
      if (video === active) send({ type: "clipEnded" });
    });
    video.addEventListener("error", () => {
      const clip = clips.get(video);
      if (clip) send({ type: "clipFailed", clipId: clip.id });
    });
    video.addEventListener("waiting", () => {
      if (video === active) stalled = true;
    });
    video.addEventListener("playing", () => {
      if (video !== active || !stalled) return;
      stalled = false;
      send({ type: "stallCleared", position: video.currentTime });
    });
    return video;
  }

  run(controller.tuneIn(channel, Date.now()));
  setInterval(() => send({ type: "tick" }), TICK_INTERVAL_MS);

  return {
    sound: {
      get muted() {
        return muted;
      },
      setMuted,
      onChange: (listener) => mutedListeners.push(listener),
    },
    get channel() {
      return channel;
    },
    tuneIn: (next) => {
      channel = next;
      run(controller.tuneIn(next, Date.now()));
    },
    setBlanked,
  };
}

// Fetches the manifest, revalidating any cached copy by its ETag.
async function fetchManifest(): Promise<PlayerEvent> {
  const requestedAt = Date.now();
  try {
    const response = await fetch(`/media/${MANIFEST_KEY}`, { cache: "no-cache" });
    if (!response.ok) return { type: "manifestFailed" };
    const manifest: Manifest = await response.json();
    // The Date header is truncated to the second; the server's time was
    // somewhere in the second after it. Without one, trust the local clock.
    const date = Date.parse(response.headers.get("Date") ?? "");
    const serverDate = Number.isNaN(date) ? Date.now() : date + 500;
    return { type: "manifestFetched", manifest, serverDate, requestedAt };
  } catch {
    return { type: "manifestFailed" };
  }
}
