// The player: two <video> elements double-buffered for hard cuts, a NO
// SIGNAL screen, and the plumbing between them and the Live Playback
// Controller. All decisions are the controller's; this only reports what
// happens and does as it's told.
import { MANIFEST_KEY, type Clip, type Manifest } from "../shared/index.ts";
import { LivePlaybackController, type Command, type PlayerEvent } from "./live-playback.ts";

// How often the controller is ticked, in milliseconds.
const TICK_INTERVAL_MS = 100;
// How far a preloaded Clip may be from where it should air before it's
// worth a seek (which costs a moment of loading), in seconds.
const SEEK_TOLERANCE_SECONDS = 0.25;

export function startPlayer(screen: HTMLElement): void {
  const controller = new LivePlaybackController();
  const noSignal = document.createElement("div");
  noSignal.className = "no-signal";
  noSignal.textContent = "NO SIGNAL";
  let active = createVideo();
  let standby = createVideo();
  screen.replaceChildren(active, standby, noSignal);
  // The Clip each element holds.
  const clips = new Map<HTMLVideoElement, Clip>();
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
          show(noSignal);
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
    active.play().catch(() => {
      // A load failure is reported through the element's error event.
    });
    show(active);
  }

  function load(video: HTMLVideoElement, clip: Clip, offset: number): void {
    // Re-setting the same src would refetch it for nothing.
    if (clips.get(video)?.id !== clip.id) {
      clips.set(video, clip);
      video.src = `/media/${clip.webEncodeKey}`;
    }
    video.currentTime = offset;
  }

  function show(element: HTMLElement): void {
    for (const child of [active, standby, noSignal]) child.hidden = child !== element;
  }

  function createVideo(): HTMLVideoElement {
    const video = document.createElement("video");
    // Browsers only autoplay muted video; playsInline keeps iOS from going
    // fullscreen.
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.hidden = true;
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

  run(controller.tuneIn());
  setInterval(() => send({ type: "tick" }), TICK_INTERVAL_MS);
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
