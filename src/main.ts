import "@fontsource/jersey-25/latin.css";
import channelConfig from "../channels.json";
import { startChannelGuide } from "./channel-guide.ts";
import { parseChannels, resolveChannel, type Channel } from "./channels.ts";
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
// An unknown Channel is corrected to the default's id.
if (named !== null && named !== channel.id) showInUrl(channel);

const app = document.querySelector<HTMLElement>("#app")!;
const player = startPlayer(app, channel);
startSoundToggle(app, player.sound);
startChannelGuide(app, channels, channel, player, showInUrl);

// Puts `channel`'s id in the URL, so it can be shared, without adding a
// history entry: Back leaves the site rather than surfing back through
// Channels.
function showInUrl(channel: Channel): void {
  const url = new URL(location.href);
  url.searchParams.set("channel", channel.id);
  history.replaceState(history.state, "", url);
}
