import { describe, expect, it } from "vitest";
import type { Clip, Manifest } from "../shared/index.ts";
import { parseChannels, type Channel } from "./channels.ts";
import { LivePlaybackController, type Command } from "./live-playback.ts";

const EPOCH = Date.parse("2026-01-01T00:00:00Z");
const SECOND = 1000;

function clip(id: string, duration: number, folder = "", details: Partial<Clip> = {}): Clip {
  return {
    id,
    webEncodeKey: `v1/${id}.mp4`,
    duration,
    recordingTime: null,
    folder,
    originalFilename: `${id}.MPG`,
    ...details,
  };
}

function channel(include?: string[], order?: string): Channel {
  return parseChannels([{ id: "test", name: "Test", ...(include && { include }), ...(order && { order }) }])[0];
}

// The whole Library, as the All Channel airs it.
const ALL = channel();

function manifestOf(...clips: Clip[]): Manifest {
  return { formatVersion: 1, scheduleEpoch: "2026-01-01T00:00:00Z", clips };
}

// Delivers `manifest`, fetched instantly from a server whose clock agrees
// with the viewer's.
function fetched(controller: LivePlaybackController, manifest: Manifest, now: number) {
  return controller.handle({ type: "manifestFetched", manifest, serverDate: now, requestedAt: now }, now);
}

// A viewer tuning in to `onChannel` at `now`: returns what the controller
// asked the player to do once the manifest arrived.
function tuneIn(manifest: Manifest, now: number, onChannel = ALL) {
  const controller = new LivePlaybackController();
  controller.tuneIn(onChannel);
  return { controller, commands: fetched(controller, manifest, now) };
}

function aired(commands: Command[]) {
  const air = commands.find((command) => command.type === "air");
  return air && { clip: air.clip.id, offset: air.offset };
}

describe("tuning in", () => {
  it("fetches the manifest first", () => {
    const controller = new LivePlaybackController();
    expect(controller.tuneIn(ALL)).toEqual([{ type: "fetchManifest" }]);
  });

  it("airs the Clip currently on the Schedule, part-way through", () => {
    const { commands } = tuneIn(manifestOf(clip("a", 10)), EPOCH + 25 * SECOND);

    expect(aired(commands)).toEqual({ clip: "a", offset: 5 });
  });
});

describe("clock correction", () => {
  it("airs what the server's clock says is on, not the viewer's skewed clock", () => {
    const manifest = manifestOf(clip("a", 10));
    const serverNow = EPOCH + 25 * SECOND;
    const skewedNow = serverNow + 3 * 60 * 60 * SECOND + 2 * SECOND;
    const controller = new LivePlaybackController();
    controller.tuneIn(ALL);

    const commands = controller.handle(
      { type: "manifestFetched", manifest, serverDate: serverNow, requestedAt: skewedNow },
      skewedNow,
    );

    expect(aired(commands)).toEqual({ clip: "a", offset: 5 });
  });

  it("assumes the server answered halfway through the request", () => {
    const manifest = manifestOf(clip("a", 10));
    const controller = new LivePlaybackController();
    controller.tuneIn(ALL);

    // Sent at local 0, answered at local 4s: the server's 25s mark was
    // local 2s, so local 4s is 27s into the Schedule.
    const commands = controller.handle(
      { type: "manifestFetched", manifest, serverDate: EPOCH + 25 * SECOND, requestedAt: 0 },
      4 * SECOND,
    );

    expect(aired(commands)).toEqual({ clip: "a", offset: 7 });
  });
});

describe("Clip boundaries", () => {
  const manifest = manifestOf(clip("a", 10), clip("b", 10), clip("c", 10));

  it("does nothing while the Clip is still airing", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);

    expect(controller.handle({ type: "tick" }, EPOCH + 9.9 * SECOND)).toEqual([]);
  });

  it("cuts to the next Clip on the Schedule when the clock reaches the boundary", () => {
    const { controller, commands } = tuneIn(manifest, EPOCH + 2 * SECOND);
    const first = aired(commands)!.clip;

    const next = aired(controller.handle({ type: "tick" }, EPOCH + 10 * SECOND));

    expect(next?.offset).toBe(0);
    expect(next?.clip).not.toBe(first);
    expect(next).toEqual(aired(tuneIn(manifest, EPOCH + 10 * SECOND).commands));
  });

  it("re-derives the position from the clock rather than starting the next Clip from the top", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);

    // The tab was asleep: the first tick after the boundary is 3s late.
    const next = aired(controller.handle({ type: "tick" }, EPOCH + 13 * SECOND));

    expect(next).toEqual(aired(tuneIn(manifest, EPOCH + 13 * SECOND).commands));
    expect(next?.offset).toBe(3);
  });

  it("cuts when the Clip ends a little before the clock says it should", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);

    const next = aired(controller.handle({ type: "clipEnded" }, EPOCH + 9.8 * SECOND));

    expect(next).toEqual(aired(tuneIn(manifest, EPOCH + 10 * SECOND).commands));
  });

  it("refetches the manifest at each boundary", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);

    expect(controller.handle({ type: "tick" }, EPOCH + 10 * SECOND)).toContainEqual({
      type: "fetchManifest",
    });
  });
});

// The Clip ids one viewer sees air through the first `count` Cycles,
// Cycle by Cycle, tuning in at the epoch and letting each Clip play to its
// end.
function watchCycles(manifest: Manifest, count: number, onChannel = ALL): string[][] {
  let now = EPOCH;
  let { controller, commands } = tuneIn(manifest, now, onChannel);
  const seen: string[] = [];
  while (seen.length < count * manifest.clips.length) {
    const air = aired(commands)!;
    seen.push(air.clip);
    now += manifest.clips.find((c) => c.id === air.clip)!.duration * SECOND;
    commands = controller.handle({ type: "clipEnded" }, now);
  }
  return Array.from({ length: count }, (_, cycle) =>
    seen.slice(cycle * manifest.clips.length, (cycle + 1) * manifest.clips.length),
  );
}

describe("the Schedule", () => {
  const library = manifestOf(
    clip("a", 10),
    clip("b", 4.5),
    clip("c", 31),
    clip("d", 7.25),
    clip("e", 12),
    clip("f", 3),
    clip("g", 60),
    clip("h", 9),
  );
  const cycles = watchCycles(library, 40);

  it("airs every Clip exactly once per Cycle", () => {
    for (const order of cycles) expect([...order].sort()).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("airs each Cycle in a different order from the one before", () => {
    for (let cycle = 1; cycle < cycles.length; cycle++) {
      expect(cycles[cycle]).not.toEqual(cycles[cycle - 1]);
    }
  });

  it("never airs the same Clip twice in a row across a Cycle boundary", () => {
    for (let cycle = 1; cycle < cycles.length; cycle++) {
      expect(cycles[cycle][0]).not.toBe(cycles[cycle - 1].at(-1));
    }
  });

  it("never airs the same Clip twice in a row with only two Clips", () => {
    const pair = manifestOf(clip("a", 10), clip("b", 5));
    const seen = watchCycles(pair, 20).flat();

    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it("stays on Schedule across many Cycles of Clips with fractional durations", () => {
    // Durations as ffprobe reports them, which don't add up exactly in
    // floating point.
    const ragged = manifestOf(
      clip("a", 10.010011),
      clip("b", 4.533367),
      clip("c", 31.1),
      clip("d", 7.296633),
      clip("e", 0.1),
    );

    for (const order of watchCycles(ragged, 300)) expect([...order].sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("is exactly the Schedule that has always aired, on a Channel airing the whole Library", () => {
    // Recorded before Channels existed: every viewer of the All Channel
    // must keep seeing precisely this.
    expect(watchCycles(library, 3).map((cycle) => cycle.join(""))).toEqual(["ehdfgbac", "bcghedaf", "eahdgbcf"]);
    expect(aired(tuneIn(library, EPOCH + 987_654_321).commands)).toEqual({ clip: "c", offset: 24.071 });
  });

  it("is the same for every viewer, however long they have been watching", () => {
    const now = EPOCH + 1234.5 * SECOND;
    const longWatcher = tuneIn(library, EPOCH).controller;
    let latest: Command[] = [];
    for (let t = EPOCH; t <= now; t += 250) {
      const commands = longWatcher.handle({ type: "tick" }, t);
      if (commands.length) latest = commands;
    }
    const justTunedIn = aired(tuneIn(library, now).commands)!;

    expect(aired(latest)?.clip).toBe(justTunedIn.clip);
  });
});

describe("Channels", () => {
  const library = manifestOf(
    clip("root", 10),
    clip("malta", 10, "Malta"),
    clip("day2", 10, "Malta/Day 2"),
    clip("maltese", 10, "Maltese"),
    clip("paris", 10, "Paris"),
  );

  // Every Clip id one viewer of `onChannel` sees air through its first
  // `slots` slots, tuning in at the epoch.
  function watch(onChannel: Channel, slots: number): string[] {
    let now = EPOCH;
    let { controller, commands } = tuneIn(library, now, onChannel);
    const seen: string[] = [];
    while (seen.length < slots) {
      seen.push(aired(commands)!.clip);
      now += 10 * SECOND;
      commands = controller.handle({ type: "clipEnded" }, now);
    }
    return seen;
  }

  it("air only the Clips in their included folders and the folders beneath them", () => {
    expect(new Set(watch(channel(["Malta"]), 20))).toEqual(new Set(["malta", "day2"]));
  });

  it("air the whole Library when they include no folders", () => {
    expect(new Set(watch(ALL, 20))).toEqual(new Set(["root", "malta", "day2", "maltese", "paris"]));
  });

  it("air their own Schedule, counting from the shared epoch", () => {
    // Malta's Cycle is 20s long, so 25s in is 5s into its second Cycle.
    const { commands } = tuneIn(library, EPOCH + 25 * SECOND, channel(["Malta"]));

    expect(aired(commands)?.offset).toBe(5);
  });

  it("air the same thing for every viewer at the same moment", () => {
    const now = EPOCH + 1234.5 * SECOND;
    const travels = channel(["Malta", "Paris"]);

    expect(aired(tuneIn(library, now, travels).commands)).toEqual(aired(tuneIn(library, now, travels).commands));
  });

  it("show NO SIGNAL when no Clips match their folders", () => {
    expect(tuneIn(library, EPOCH, channel(["Tokyo"])).commands).toEqual([{ type: "noSignal" }]);
  });
});

describe("chronological Channels", () => {
  const CHRONOLOGICAL = channel(undefined, "chronological");

  function shotAt(id: string, duration: number, recordingTime: string): Clip {
    return clip(id, duration, "", { recordingTime });
  }

  it("air their Clips in Recording-time order", () => {
    // Library order isn't shooting order: camcorder filenames restart
    // across tapes.
    const library = manifestOf(
      shotAt("evening", 10, "2004-08-02T19:30:00"),
      shotAt("morning", 4.5, "2004-08-02T08:15:00"),
      shotAt("next-day", 31, "2004-08-03T11:00:00"),
      shotAt("arrival", 7.25, "2004-08-01T16:45:10"),
    );

    expect(watchCycles(library, 1, CHRONOLOGICAL)).toEqual([["arrival", "morning", "evening", "next-day"]]);
  });

  it("air the same sequence every Cycle, on Schedule, with fractional durations", () => {
    const library = manifestOf(
      shotAt("b", 4.533367, "2004-08-02T08:15:00"),
      shotAt("a", 10.010011, "2004-08-01T16:45:10"),
      shotAt("d", 7.296633, "2004-08-04T09:00:00"),
      shotAt("c", 0.1, "2004-08-03T11:00:00"),
    );

    expect(watchCycles(library, 300, CHRONOLOGICAL)).toEqual(Array(300).fill(["a", "b", "c", "d"]));
  });

  it("air Clips with no Recording time last, by folder then original filename", () => {
    const library = manifestOf(
      clip("tape2-first", 10, "Malta/Day 2", { originalFilename: "M2U00001.MPG" }),
      clip("root-late", 10, "", { originalFilename: "M2U00090.MPG" }),
      shotAt("dated", 10, "2004-08-01T16:45:10"),
      clip("tape1-second", 10, "Malta", { originalFilename: "M2U00027.MPG" }),
      clip("tape1-first", 10, "Malta", { originalFilename: "M2U00003.MPG" }),
      clip("root-early", 10, "", { originalFilename: "M2U00002.MPG" }),
    );

    expect(watchCycles(library, 2, CHRONOLOGICAL)).toEqual(
      Array(2).fill(["dated", "root-early", "root-late", "tape1-first", "tape1-second", "tape2-first"]),
    );
  });
});

describe("preloading", () => {
  const manifest = manifestOf(clip("a", 10), clip("b", 10), clip("c", 10));

  function preloaded(commands: Command[]) {
    const preload = commands.find((command) => command.type === "preload");
    return preload && preload.clip.id;
  }

  it("preloads the Clip that airs next when tuning in", () => {
    const { commands } = tuneIn(manifest, EPOCH + 2 * SECOND);

    expect(preloaded(commands)).toBe(aired(tuneIn(manifest, EPOCH + 10 * SECOND).commands)?.clip);
  });

  it("preloads the following Clip at each boundary, across Cycle boundaries too", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);
    controller.handle({ type: "tick" }, EPOCH + 10 * SECOND);
    const atLastClip = controller.handle({ type: "tick" }, EPOCH + 20 * SECOND);

    expect(preloaded(atLastClip)).toBe(aired(tuneIn(manifest, EPOCH + 30 * SECOND).commands)?.clip);
  });
});

describe("recovering from a stall", () => {
  const manifest = manifestOf(clip("a", 30), clip("b", 30), clip("c", 30));

  it("snaps back to live when playback has fallen more than ~2s behind", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);

    // Stalled at 4s into the Clip; the clock now says 9s in.
    const commands = controller.handle({ type: "stallCleared", position: 4 }, EPOCH + 9 * SECOND);

    expect(commands).toEqual([{ type: "snapToLive", offset: 9 }]);
  });

  it("carries on when the stall left playback less than ~2s behind", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);

    expect(controller.handle({ type: "stallCleared", position: 7.5 }, EPOCH + 9 * SECOND)).toEqual([]);
  });

  it("cuts to whatever is on now when the stall outlasted the Clip", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);

    const commands = controller.handle({ type: "stallCleared", position: 4 }, EPOCH + 35 * SECOND);

    expect(aired(commands)).toEqual(aired(tuneIn(manifest, EPOCH + 35 * SECOND).commands));
  });
});

describe("a Clip that fails to load", () => {
  const manifest = manifestOf(clip("a", 10), clip("b", 10), clip("c", 10));
  const onAt = (time: number) => aired(tuneIn(manifest, EPOCH + time * SECOND).commands)!.clip;

  it("is skipped, showing NO SIGNAL for the rest of its slot", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);

    const commands = controller.handle({ type: "clipFailed", clipId: onAt(2) }, EPOCH + 3 * SECOND);

    expect(commands).toEqual([{ type: "noSignal" }]);
  });

  it("doesn't knock playback off the Schedule", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);
    controller.handle({ type: "clipFailed", clipId: onAt(2) }, EPOCH + 3 * SECOND);

    const next = aired(controller.handle({ type: "tick" }, EPOCH + 10 * SECOND));

    expect(next).toEqual({ clip: onAt(10), offset: 0 });
  });

  it("is skipped when it was the preloaded Clip, and the one after it still airs on time", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);
    controller.handle({ type: "clipFailed", clipId: onAt(10) }, EPOCH + 3 * SECOND);

    const atFailedSlot = controller.handle({ type: "tick" }, EPOCH + 10 * SECOND);
    expect(atFailedSlot).toContainEqual({ type: "noSignal" });
    expect(aired(atFailedSlot)).toBeUndefined();

    expect(aired(controller.handle({ type: "tick" }, EPOCH + 20 * SECOND))).toEqual({
      clip: onAt(20),
      offset: 0,
    });
  });
});

describe("NO SIGNAL", () => {
  const manifest = manifestOf(clip("a", 10), clip("b", 10), clip("c", 10));

  it("shows when the manifest can't be fetched", () => {
    const controller = new LivePlaybackController();
    controller.tuneIn(ALL);

    expect(controller.handle({ type: "manifestFailed" }, EPOCH)).toEqual([{ type: "noSignal" }]);
  });

  it("shows when the Library is empty", () => {
    const controller = new LivePlaybackController();
    controller.tuneIn(ALL);

    expect(fetched(controller, manifestOf(), EPOCH)).toEqual([{ type: "noSignal" }]);
  });

  it("retries the manifest every 30s", () => {
    const controller = new LivePlaybackController();
    controller.tuneIn(ALL);
    controller.handle({ type: "manifestFailed" }, EPOCH);

    expect(controller.handle({ type: "tick" }, EPOCH + 29 * SECOND)).toEqual([]);
    expect(controller.handle({ type: "tick" }, EPOCH + 30 * SECOND)).toEqual([{ type: "fetchManifest" }]);
    expect(controller.handle({ type: "tick" }, EPOCH + 31 * SECOND)).toEqual([]);
    expect(fetched(controller, manifestOf(), EPOCH + 31 * SECOND)).toEqual([{ type: "noSignal" }]);
    expect(controller.handle({ type: "tick" }, EPOCH + 60 * SECOND)).toEqual([]);
    expect(controller.handle({ type: "tick" }, EPOCH + 61 * SECOND)).toEqual([{ type: "fetchManifest" }]);
  });

  it("recovers on its own once the manifest is available", () => {
    const controller = new LivePlaybackController();
    controller.tuneIn(ALL);
    controller.handle({ type: "manifestFailed" }, EPOCH);
    controller.handle({ type: "tick" }, EPOCH + 30 * SECOND);

    const commands = fetched(controller, manifest, EPOCH + 31 * SECOND);

    expect(aired(commands)).toEqual(aired(tuneIn(manifest, EPOCH + 31 * SECOND).commands));
  });

  it("keeps airing the Schedule it has when a refetch at a boundary fails", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);
    controller.handle({ type: "tick" }, EPOCH + 10 * SECOND);

    expect(controller.handle({ type: "manifestFailed" }, EPOCH + 10.1 * SECOND)).toEqual([]);
    expect(aired(controller.handle({ type: "tick" }, EPOCH + 20 * SECOND))).toEqual(
      aired(tuneIn(manifest, EPOCH + 20 * SECOND).commands),
    );
  });
});

describe("Library changes", () => {
  const manifest = manifestOf(clip("a", 10), clip("b", 10), clip("c", 10));

  it("leaves playback alone when the refetched manifest is unchanged", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);
    controller.handle({ type: "tick" }, EPOCH + 10 * SECOND);

    expect(fetched(controller, structuredClone(manifest), EPOCH + 10.2 * SECOND)).toEqual([]);
  });

  it("doesn't cut back when the refetch lands just after a Clip ended early", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);
    controller.handle({ type: "clipEnded" }, EPOCH + 9.8 * SECOND);

    expect(fetched(controller, structuredClone(manifest), EPOCH + 9.9 * SECOND)).toEqual([]);
  });

  it("doesn't cut back when a refetch nudges the clock correction backwards", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);
    controller.handle({ type: "tick" }, EPOCH + 10 * SECOND);

    // The server's second-truncated Date makes it look 0.6s earlier.
    const now = EPOCH + 10.1 * SECOND;
    const commands = controller.handle(
      { type: "manifestFetched", manifest, serverDate: now - 0.6 * SECOND, requestedAt: now },
      now,
    );

    expect(commands).toEqual([]);
  });

  it("airs Clips added to the Library, without a reload, from the next boundary", () => {
    const { controller } = tuneIn(manifest, EPOCH + 2 * SECOND);
    controller.handle({ type: "tick" }, EPOCH + 10 * SECOND);
    const grown = manifestOf(...manifest.clips, clip("d", 10), clip("e", 10));

    const commands = fetched(controller, grown, EPOCH + 10.2 * SECOND);

    // Every viewer converges on the new Schedule.
    expect(aired(commands)).toEqual(aired(tuneIn(grown, EPOCH + 10.2 * SECOND).commands));
    const seen = new Set(watchCycles(grown, 1).flat());
    expect(seen).toEqual(new Set(["a", "b", "c", "d", "e"]));
  });
});
