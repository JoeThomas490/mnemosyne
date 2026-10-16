import { MANIFEST_KEY, type Manifest } from "../shared/index.ts";
import "./style.css";

// First end-to-end path: fetch the manifest through the media route and air
// its first Clip. The Schedule, double-buffered player and CRT rendering
// replace this later.
const app = document.querySelector<HTMLElement>("#app")!;

async function tuneIn(): Promise<void> {
  const response = await fetch(`/media/${MANIFEST_KEY}`);
  if (!response.ok) throw new Error(`manifest request failed: ${response.status}`);
  const manifest: Manifest = await response.json();
  const clip = manifest.clips[0];
  if (!clip) throw new Error("the Library is empty");

  const video = document.createElement("video");
  // Browsers only autoplay muted video; playsInline keeps iOS from going
  // fullscreen.
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.src = `/media/${clip.webEncodeKey}`;
  app.replaceChildren(video);
}

tuneIn().catch((error: unknown) => {
  console.error(error);
  app.textContent = "NO SIGNAL";
});
