import "@fontsource/jersey-25/latin.css";
import { LOOK } from "./look.ts";
import { startPlayer } from "./player.ts";
import { startSoundToggle } from "./sound-toggle.ts";
import "./style.css";

document.body.style.background = LOOK.background;
// Landing on the site Tunes in to the All Channel, muted until the viewer
// turns the sound on.
const app = document.querySelector<HTMLElement>("#app")!;
startSoundToggle(app, startPlayer(app));
