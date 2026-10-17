import "@fontsource/jersey-25/latin.css";
import channelConfig from "../channels.json";
import { parseChannels, resolveChannel } from "./channels.ts";
import { LOOK } from "./look.ts";
import { startPlayer } from "./player.ts";
import { startSoundToggle } from "./sound-toggle.ts";
import "./style.css";

document.body.style.background = LOOK.background;

// Landing on the site Tunes in to the Channel the URL names (?channel=),
// or the default Channel, muted until the viewer turns the sound on.
const channels = parseChannels(channelConfig);
const url = new URL(location.href);
const named = url.searchParams.get("channel");
const channel = resolveChannel(channels, named);
// An unknown Channel is corrected to the default's id, without adding a
// history entry.
if (named !== null && named !== channel.id) {
  url.searchParams.set("channel", channel.id);
  history.replaceState(history.state, "", url);
}

const app = document.querySelector<HTMLElement>("#app")!;
startSoundToggle(app, startPlayer(app, channel));
