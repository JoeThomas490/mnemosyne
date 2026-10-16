import { startPlayer } from "./player.ts";
import "./style.css";

// Landing on the site Tunes in to the All Channel.
startPlayer(document.querySelector<HTMLElement>("#app")!);
