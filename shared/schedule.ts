// The Schedule (ADR 0001): what airs at any instant on a Channel, derived
// from its Clips, the shared epoch and the clock alone so every viewer
// computes the same thing.
// Changing anything here changes what airs for everyone.
import type { Clip } from "./manifest.ts";

// One Clip's slot in the Schedule.
export interface Airing {
  clip: Clip;
  // When the slot begins and ends, in milliseconds since the Unix epoch.
  start: number;
  end: number;
}

// The Airing on at `now` on the Schedule of `clips` (a Channel's Clips, in
// manifest order) counting from `epoch`, or null when nothing can air (no
// Clips). Times are ms since the Unix epoch; `epoch` is the manifest's
// `scheduleEpoch`, shared by every Channel.
export function airingAt(clips: readonly Clip[], epoch: number, now: number): Airing | null {
  const cycleLength = clips.reduce((total, clip) => total + durationMs(clip), 0);
  if (cycleLength <= 0) return null;
  const cycle = Math.floor((now - epoch) / cycleLength);
  let start = epoch + cycle * cycleLength;
  for (const clip of cycleOrder(clips, cycle)) {
    const end = start + durationMs(clip);
    if (now < end) return { clip, start, end };
    start = end;
  }
  // Unreachable: whole-millisecond slots add up exactly to the Cycle.
  throw new Error(`no Clip airs at ${now}`);
}

// Slots are whole milliseconds, so they add up exactly: a Cycle's last slot
// ends precisely where the next Cycle begins, whatever the durations.
function durationMs(clip: Clip): number {
  return Math.round(clip.duration * 1000);
}

// The order Cycle `cycle` airs the Clips in: a shuffle seeded by the Cycle
// number, adjusted so no Clip airs twice in a row across Cycles.
function cycleOrder(clips: readonly Clip[], cycle: number): readonly Clip[] {
  // With two Clips, only repeating the same order every Cycle avoids a
  // back-to-back repeat (and with one, there's no avoiding it).
  if (clips.length <= 2) return clips;
  const order = shuffled(clips, cycle);
  // The swap only touches the first two positions, so the previous Cycle's
  // last Clip is its unadjusted shuffle's last Clip.
  if (order[0] === shuffled(clips, cycle - 1).at(-1)) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

// Fisher–Yates, driven by a PRNG seeded with `seed`.
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = seededRandom(seed);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// A seeded stand-in for Math.random, yielding numbers in [0, 1): the same
// seed always gives the same sequence, in every JavaScript engine. This is
// Mulberry32, a standard public-domain PRNG copied verbatim; treat it as a
// black box, but never change it, or the Schedule changes for everyone.
function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
