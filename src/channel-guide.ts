// The Channel Guide: a `[G] GUIDE` prompt in the bottom-left, in the Date
// stamp's typeface and colour, that opens a flat overlay listing every
// Channel. Number keys [1]–[9] Tune in directly, Guide open or not. While
// the Guide is open the picture is blanked (hidden and muted) but the
// Channel keeps airing. A thin DOM shell: what to air is the player's.
import type { Channel } from "./channels.ts";
import { fadeWhenIdle } from "./idle-fade.ts";
import { LOOK } from "./look.ts";
import type { Player } from "./player.ts";

export function startChannelGuide(
  parent: HTMLElement,
  channels: readonly Channel[],
  initial: Channel,
  player: Player,
  // Called after each switch, with the Channel now airing.
  onTunedIn: (channel: Channel) => void,
): void {
  const { font, colour, stroke } = LOOK.dateStamp;
  parent.style.setProperty("--stamp-font", `"${font}"`);
  parent.style.setProperty("--stamp-colour", colour);
  parent.style.setProperty("--stamp-stroke", stroke.colour);

  const prompt = document.createElement("button");
  prompt.type = "button";
  prompt.className = "guide-prompt";
  prompt.textContent = "[G] GUIDE";
  prompt.setAttribute("aria-label", "Channel Guide");
  prompt.setAttribute("aria-expanded", "false");

  const guide = document.createElement("div");
  guide.className = "channel-guide";
  guide.hidden = true;
  const list = document.createElement("ul");
  const lines = channels.map((channel, index) => {
    const line = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const marker = document.createElement("span");
    marker.className = "marker";
    button.append(marker, `${index + 1}  ${channel.name.toUpperCase()}`);
    button.addEventListener("click", () => tuneIn(channel));
    button.addEventListener("pointerenter", () => highlight(index));
    line.append(button);
    list.append(line);
    return { line, marker };
  });
  guide.append(list);
  parent.append(guide, prompt);

  let current = initial;
  let highlighted = 0;
  let isOpen = false;

  function highlight(index: number): void {
    highlighted = (index + channels.length) % channels.length;
    lines.forEach(({ line }, i) => line.classList.toggle("highlighted", i === highlighted));
  }

  function setOpen(open: boolean): void {
    if (open === isOpen) return;
    isOpen = open;
    guide.hidden = !open;
    prompt.setAttribute("aria-expanded", String(open));
    player.setBlanked(open);
    if (!open) return;
    const at = channels.indexOf(current);
    lines.forEach(({ marker }, i) => (marker.textContent = i === at ? "▶" : ""));
    highlight(at);
  }

  function tuneIn(channel: Channel): void {
    setOpen(false);
    if (channel === current) return;
    current = channel;
    player.tuneIn(channel);
    onTunedIn(channel);
  }

  const pressWokeIt = fadeWhenIdle(prompt);
  prompt.addEventListener("click", () => {
    if (!pressWokeIt()) setOpen(!isOpen);
  });
  // Empty space around the lines closes the Guide.
  guide.addEventListener("click", (event) => {
    if (!(event.target as Element).closest("button")) setOpen(false);
  });

  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const number = Number(event.key);
    if (Number.isInteger(number) && number >= 1 && number <= 9) {
      if (number <= channels.length) tuneIn(channels[number - 1]);
    } else if (event.key === "g" || event.key === "G") setOpen(!isOpen);
    else if (isOpen && event.key === "Escape") setOpen(false);
    else if (isOpen && event.key === "ArrowUp") highlight(highlighted - 1);
    else if (isOpen && event.key === "ArrowDown") highlight(highlighted + 1);
    else if (isOpen && event.key === "Enter") tuneIn(channels[highlighted]);
    else return;
    // Keep a focused button from also acting on the key, and arrows from
    // scrolling.
    event.preventDefault();
  });
}
