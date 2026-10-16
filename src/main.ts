import "@fontsource/jersey-25/latin.css";
import { LOOK } from "./look.ts";
import { startPlayer } from "./player.ts";
import "./style.css";

document.body.style.background = LOOK.background;
// Landing on the site Tunes in to the All Channel.
startPlayer(document.querySelector<HTMLElement>("#app")!);
