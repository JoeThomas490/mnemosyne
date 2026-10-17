// The fade shared by the controls over the picture (the sound toggle and
// the Channel Guide prompt): they fade out when the viewer leaves the
// mouse, screen and keyboard alone, and come back on any activity, so the
// picture is left clear for leaning back.

// How long without mouse, touch or keyboard activity before a control
// fades out, in milliseconds.
const HIDE_AFTER_MS = 3000;

// Fades `control` out after inactivity (by its `idle` class; see
// style.css). Returns whether the latest press is the one that woke it: a
// tap where the faded-out control sits only brings it back. It ignores the
// pointer while faded, but iOS hit-tests the tap's click after the control
// has reappeared, so its click handler should drop the click of such a
// press.
export function fadeWhenIdle(control: HTMLElement): () => boolean {
  let pressWokeIt = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  function wake(event?: Event): void {
    if (event?.type === "pointerdown") pressWokeIt = control.classList.contains("idle");
    else if (event?.type === "keydown") pressWokeIt = false;
    control.classList.remove("idle");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => control.classList.add("idle"), HIDE_AFTER_MS);
  }
  for (const type of ["pointermove", "pointerdown", "keydown"]) {
    window.addEventListener(type, wake, { passive: true });
  }
  wake();
  return () => pressWokeIt;
}
