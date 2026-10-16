// The one control over the picture: a toggle to turn the sound on after
// muted autoplay, and off again. It fades out when the viewer leaves the
// mouse or screen alone, and comes back on any activity, so the picture is
// left clear for leaning back.
import type { PlayerSound } from "./player.ts";

// How long without mouse, touch or keyboard activity before the toggle
// fades out, in milliseconds.
const HIDE_AFTER_MS = 3000;

// A speaker, with sound waves when on or a cross when muted.
const SPEAKER = '<path d="M3 9h4l5-4v14l-5-4H3z" fill="currentColor"/>';
const WAVES =
  '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
const CROSS = '<path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';

export function startSoundToggle(parent: HTMLElement, sound: PlayerSound): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sound-toggle";
  parent.append(button);

  function render(muted: boolean): void {
    button.setAttribute("aria-label", muted ? "Turn sound on" : "Turn sound off");
    button.setAttribute("aria-pressed", String(!muted));
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${SPEAKER}${muted ? CROSS : WAVES}</svg>`;
  }

  // A tap where the faded-out toggle sits only brings it back. It ignores
  // the pointer while faded (see style.css), but iOS hit-tests the tap's
  // click after the toggle has reappeared, so also drop the click of a
  // press that woke it.
  let pressWokeIt = false;
  button.addEventListener("click", () => {
    if (!pressWokeIt) sound.setMuted(!sound.muted);
  });
  sound.onChange(render);
  render(sound.muted);

  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  function wake(event?: Event): void {
    if (event?.type === "pointerdown") pressWokeIt = button.classList.contains("idle");
    else if (event?.type === "keydown") pressWokeIt = false;
    button.classList.remove("idle");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => button.classList.add("idle"), HIDE_AFTER_MS);
  }
  for (const type of ["pointermove", "pointerdown", "keydown"]) {
    window.addEventListener(type, wake, { passive: true });
  }
  wake();
}
