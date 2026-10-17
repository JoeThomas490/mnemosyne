import { beforeEach, describe, expect, it } from "vitest";
import { MANIFEST_KEY, type Clip } from "../../shared/index.ts";
import { ingest } from "./ingest.ts";
import { remove, removeAll } from "./remove.ts";
import {
  FakeEncoder,
  InMemoryBucket,
  RecordingLog,
  clipIn,
  folderOf,
  publishLibrary,
  readManifest,
} from "./test-support.ts";

let originals: InMemoryBucket;
let web: InMemoryBucket;

beforeEach(() => {
  originals = new InMemoryBucket();
  web = new InMemoryBucket();
});

function run(
  target: string,
  options: { purge?: boolean; choose?: (matches: Clip[]) => Promise<Clip | null> } = {},
) {
  return remove(target, {
    originals,
    web,
    log: new RecordingLog(),
    purge: options.purge ?? false,
    choose: options.choose ?? (() => Promise.reject(new Error("unexpectedly asked to choose"))),
  });
}

describe("remove: by relative path", () => {
  it("removes exactly that Clip, deleting its web encode but keeping its archived Original", async () => {
    const malta = clipIn("Malta", "M2U00001.MPG");
    const zoo = clipIn("Zoo", "M2U00001.MPG");
    await publishLibrary(web, [malta, zoo], originals);

    await run("Malta/M2U00001.MPG");

    expect(readManifest(web).clips).toEqual([zoo]);
    expect(web.objects.has(malta.webEncodeKey)).toBe(false);
    expect(web.objects.has(zoo.webEncodeKey)).toBe(true);
    expect(originals.objects.has(malta.id)).toBe(true);
  });
});

describe("remove: by bare Original filename", () => {
  it("removes the one Clip with that filename", async () => {
    const one = clipIn("Malta/Day 1", "M2U00001.MPG");
    const other = clipIn("Malta/Day 1", "M2U00002.MPG");
    await publishLibrary(web, [one, other], originals);

    expect(await run("M2U00001.MPG")).toEqual(one);

    expect(readManifest(web).clips).toEqual([other]);
    expect(web.objects.has(one.webEncodeKey)).toBe(false);
  });

  it("asks the owner to choose among several Clips with that filename, and removes their choice", async () => {
    // Sony restarts M2U numbering on each card.
    const malta = clipIn("Malta", "M2U00001.MPG", { recordingTime: "2026-04-04T14:17:16" });
    const zoo = clipIn("Zoo", "M2U00001.MPG", { recordingTime: "2026-10-03T07:14:45" });
    const other = clipIn("Zoo", "M2U00002.MPG");
    await publishLibrary(web, [malta, other, zoo], originals);

    let offered: Clip[] = [];
    const removed = await run("M2U00001.MPG", {
      choose: async (matches) => {
        offered = matches;
        return matches.find((clip) => clip.folder === "Zoo") ?? null;
      },
    });

    expect(offered).toEqual([malta, zoo]);
    expect(removed).toEqual(zoo);
    expect(readManifest(web).clips).toEqual([malta, other]);
    expect(web.objects.has(zoo.webEncodeKey)).toBe(false);
    expect(web.objects.has(malta.webEncodeKey)).toBe(true);
  });

  it("removes nothing when the owner chooses none of them", async () => {
    await publishLibrary(web, [clipIn("Malta", "M2U00001.MPG"), clipIn("Zoo", "M2U00001.MPG")]);
    const manifestBefore = web.text(MANIFEST_KEY);
    const writesBefore = web.writes;

    expect(await run("M2U00001.MPG", { choose: async () => null })).toBeNull();

    expect(web.writes).toBe(writesBefore);
    expect(web.text(MANIFEST_KEY)).toBe(manifestBefore);
  });
});

describe("remove: a target matching no Clip", () => {
  it.each([["Malta/M2U00009.MPG"], ["M2U00009.MPG"], ["Zoo/M2U00001.MPG"]])(
    "fails for %s, leaving the Library untouched",
    async (target) => {
      await publishLibrary(web, [clipIn("Malta", "M2U00001.MPG")]);
      const writesBefore = web.writes;

      await expect(run(target)).rejects.toThrow(target);

      expect(web.writes).toBe(writesBefore);
    },
  );
});

describe("remove: with --purge", () => {
  it("deletes the archived Original too", async () => {
    const clip = clipIn("Malta", "M2U00001.MPG");
    const other = clipIn("Malta", "M2U00002.MPG");
    await publishLibrary(web, [clip, other], originals);

    await run("Malta/M2U00001.MPG", { purge: true });

    expect(readManifest(web).clips).toEqual([other]);
    expect(web.objects.has(clip.webEncodeKey)).toBe(false);
    expect(originals.objects.has(clip.id)).toBe(false);
    expect(originals.objects.has(other.id)).toBe(true);
  });
});

describe("removeAll", () => {
  function runAll(purge = false) {
    return removeAll({ originals, web, log: new RecordingLog(), purge });
  }

  it("takes every Clip off air, deleting their web encodes but keeping their archived Originals", async () => {
    const clips = [clipIn("Malta", "M2U00001.MPG"), clipIn("Zoo", "M2U00001.MPG")];
    await publishLibrary(web, clips, originals);

    expect(await runAll()).toEqual(clips);

    expect(readManifest(web).clips).toEqual([]);
    for (const clip of clips) {
      expect(web.objects.has(clip.webEncodeKey)).toBe(false);
      expect(originals.objects.has(clip.id)).toBe(true);
    }
  });

  it("with --purge, deletes their archived Originals too", async () => {
    const clips = [clipIn("Malta", "M2U00001.MPG"), clipIn("Zoo", "M2U00001.MPG")];
    await publishLibrary(web, clips, originals);

    await runAll(true);

    expect(readManifest(web).clips).toEqual([]);
    for (const clip of clips) expect(originals.objects.has(clip.id)).toBe(false);
  });

  it("leaves an empty Library untouched", async () => {
    await publishLibrary(web, []);
    const writesBefore = web.writes;

    expect(await runAll()).toEqual([]);

    expect(web.writes).toBe(writesBefore);
  });
});

describe("remove: then re-ingesting", () => {
  it("restores a removed Clip from its kept archived Original", async () => {
    const root = await folderOf({ "Malta/M2U00001.MPG": "a", "Malta/M2U00002.MPG": "b" });
    const ingestRoot = () =>
      ingest(root, { originals, web, encoder: new FakeEncoder(), log: new RecordingLog(), encodeVersion: 1 });
    await ingestRoot();
    const before = readManifest(web).clips;

    await run("Malta/M2U00001.MPG");
    const result = await ingestRoot();

    expect(result.added).toBe(1);
    expect(readManifest(web).clips).toEqual(expect.arrayContaining(before));
    expect(readManifest(web).clips).toHaveLength(2);
    expect(web.text(before[0]!.webEncodeKey)).toBe("web:a");
  });
});
