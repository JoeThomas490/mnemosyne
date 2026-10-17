import { mkdir, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { MANIFEST_KEY } from "../../shared/index.ts";
import { ingest } from "./ingest.ts";
import {
  FakeEncoder,
  InMemoryBucket,
  RecordingLog,
  clipIn,
  folderOf,
  publishLibrary,
  originalRecordedAt,
  readManifest,
} from "./test-support.ts";

// SHA-256 of the strings "a", "b" and "bb": the content hashes of the fake
// Originals below.
const HASH_A = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";
const HASH_B = "3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d";
const HASH_BB = "3b64db95cb55c763391c707108489ae18b4112d783300de38e033b4c98c3deaf";

let originals: InMemoryBucket;
let web: InMemoryBucket;
let log: RecordingLog;

beforeEach(() => {
  originals = new InMemoryBucket();
  web = new InMemoryBucket();
  log = new RecordingLog();
});

function run(root: string, options: { encoder?: FakeEncoder; encodeVersion?: number } = {}) {
  return ingest(root, {
    originals,
    web,
    encoder: options.encoder ?? new FakeEncoder(),
    log,
    encodeVersion: options.encodeVersion ?? 1,
  });
}

describe("ingest: a new folder", () => {
  it("archives each Original to the originals bucket, keyed by content hash", async () => {
    await run(await folderOf({ "M2U00001.MPG": "a", "M2U00002.MPG": "b" }));

    expect(originals.text(HASH_A)).toBe("a");
    expect(originals.text(HASH_B)).toBe("b");
  });

  it("uploads each web encode keyed by encode version and content hash", async () => {
    await run(await folderOf({ "M2U00001.MPG": "a" }), { encodeVersion: 3 });

    expect(web.text(`v3/${HASH_A}.mp4`)).toBe("web:a");
    expect(web.objects.get(`v3/${HASH_A}.mp4`)?.contentType).toBe("video/mp4");
  });

  it("publishes a manifest describing each Clip", async () => {
    await run(await folderOf({ "M2U00001.MPG": "a", "Malta/Day 1/M2U00002.MPG": "bb" }));

    const manifest = readManifest(web);
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.scheduleEpoch).toBe("2026-01-01T00:00:00Z");
    expect(manifest.clips).toEqual([
      {
        id: HASH_A,
        webEncodeKey: `v1/${HASH_A}.mp4`,
        duration: 1,
        recordingTime: null,
        folder: "",
        originalFilename: "M2U00001.MPG",
      },
      {
        id: HASH_BB,
        webEncodeKey: `v1/${HASH_BB}.mp4`,
        duration: 2,
        recordingTime: null,
        folder: "Malta/Day 1",
        originalFilename: "M2U00002.MPG",
      },
    ]);
  });

  it("ingests only Originals (.MPG files, any case), ignoring everything else", async () => {
    await run(
      await folderOf({
        "M2U00001.MPG": "a",
        "Malta/m2u00002.mpg": "b",
        ".DS_Store": "x",
        "convert_mpg": "x",
        "notes.txt": "x",
        "Malta/._M2U00003.MPG": "x",
      }),
    );

    expect(readManifest(web).clips.map((clip) => clip.originalFilename)).toEqual([
      "M2U00001.MPG",
      "m2u00002.mpg",
    ]);
    expect([...originals.objects.keys()].sort()).toEqual([HASH_B, HASH_A]);
  });
});

describe("ingest: re-running", () => {
  it("does nothing new when re-run on the same folder", async () => {
    const root = await folderOf({ "M2U00001.MPG": "a", "Malta/M2U00002.MPG": "b" });
    await run(root);
    const manifestBefore = web.text(MANIFEST_KEY);
    const writesBefore = originals.writes + web.writes;
    log = new RecordingLog();

    const encoder = new FakeEncoder();
    await run(root, { encoder });

    expect(originals.writes + web.writes).toBe(writesBefore);
    expect(encoder.encodes).toBe(0);
    expect(web.text(MANIFEST_KEY)).toBe(manifestBefore);
    expect(log.warnings).toEqual([]);
  });

  it("adds only the new Originals and keeps the Library's existing Clips first", async () => {
    const root = await folderOf({ "M2U00001.MPG": "a" });
    await run(root);
    const epoch = readManifest(web).scheduleEpoch;

    const encoder = new FakeEncoder();
    await run(await folderOf({ "M2U00001.MPG": "a", "M2U00002.MPG": "b" }), { encoder });

    expect(encoder.encodes).toBe(1);
    expect(readManifest(web).clips.map((clip) => clip.id)).toEqual([HASH_A, HASH_B]);
    expect(readManifest(web).scheduleEpoch).toBe(epoch);
  });

  it("keeps Clips whose Originals are absent locally", async () => {
    await run(await folderOf({ "Malta/M2U00001.MPG": "a" }));

    await run(await folderOf({ "M2U00002.MPG": "b" }));

    const clips = readManifest(web).clips;
    expect(clips.map((clip) => [clip.id, clip.folder])).toEqual([
      [HASH_A, "Malta"],
      [HASH_B, ""],
    ]);
    expect(web.text(`v1/${HASH_A}.mp4`)).toBe("web:a");
  });

  it("keeps an existing manifest's Schedule epoch", async () => {
    web.objects.set(MANIFEST_KEY, {
      bytes: Buffer.from(
        JSON.stringify({ formatVersion: 1, scheduleEpoch: "2025-06-01T00:00:00Z", clips: [] }),
      ),
      contentType: "application/json",
    });

    await run(await folderOf({ "M2U00001.MPG": "a" }));

    expect(readManifest(web).scheduleEpoch).toBe("2025-06-01T00:00:00Z");
  });
});

describe("ingest: duplicate content", () => {
  it("skips the same content in a later folder with a warning; the first folder wins", async () => {
    const encoder = new FakeEncoder();
    await run(
      await folderOf({ "Malta/M2U00001.MPG": "a", "Zoo/M2U00007.MPG": "a" }),
      { encoder },
    );

    expect(encoder.encodes).toBe(1);
    expect(readManifest(web).clips).toHaveLength(1);
    expect(readManifest(web).clips[0]).toMatchObject({ folder: "Malta", originalFilename: "M2U00001.MPG" });
    const skipped = duplicateWarnings();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("Zoo/M2U00007.MPG");
    expect(skipped[0]).toContain("Malta/M2U00001.MPG");
  });

  it("warns when content already in the Library turns up somewhere else", async () => {
    await run(await folderOf({ "Malta/M2U00001.MPG": "a" }));

    log = new RecordingLog();
    await run(await folderOf({ "Copies/M2U00001.MPG": "a" }));

    expect(readManifest(web).clips[0]).toMatchObject({ folder: "Malta" });
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]).toContain("Copies/M2U00001.MPG");
    expect(log.warnings[0]).toContain("Malta/M2U00001.MPG");
  });
});

describe("ingest: after the encode version is bumped", () => {
  it("re-encodes every Clip from its archived Original and switches the manifest to the new keys", async () => {
    await run(await folderOf({ "Malta/M2U00001.MPG": "a", "M2U00002.MPG": "bb" }));

    // The Originals aren't available locally this time: the Malta one only
    // exists in the archive.
    await run(await folderOf({}), { encoder: new FakeEncoder("v2"), encodeVersion: 2 });

    expect(web.text(`v2/${HASH_A}.mp4`)).toBe("v2:a");
    expect(web.text(`v2/${HASH_BB}.mp4`)).toBe("v2:bb");
    expect(readManifest(web).clips).toEqual([
      expect.objectContaining({ id: HASH_BB, webEncodeKey: `v2/${HASH_BB}.mp4`, folder: "" }),
      expect.objectContaining({ id: HASH_A, webEncodeKey: `v2/${HASH_A}.mp4`, folder: "Malta" }),
    ]);
  });

  it("takes each re-encoded Clip's duration from its new encode", async () => {
    await run(await folderOf({ "M2U00001.MPG": "bb" }));

    await run(await folderOf({}), { encoder: new FakeEncoder("v2", () => 99), encodeVersion: 2 });

    expect(readManifest(web).clips[0]?.duration).toBe(99);
  });

  it("encodes new Originals straight to the new version", async () => {
    await run(await folderOf({ "M2U00001.MPG": "a" }));

    await run(await folderOf({ "M2U00002.MPG": "b" }), { encodeVersion: 2 });

    expect(readManifest(web).clips.map((clip) => clip.webEncodeKey)).toEqual([
      `v2/${HASH_A}.mp4`,
      `v2/${HASH_B}.mp4`,
    ]);
  });

  it("keeps a Clip's old encode, and reports it, when its re-encode fails", async () => {
    await run(await folderOf({ "M2U00001.MPG": "a", "M2U00002.MPG": "corrupt" }));

    const failOn = (original: string) => {
      if (original === "corrupt") throw new Error("ffmpeg exited with code 1");
      return original.length;
    };
    const result = await run(await folderOf({}), {
      encoder: new FakeEncoder("v2", failOn),
      encodeVersion: 2,
    });

    expect(result.failed).toEqual(["M2U00002.MPG"]);
    expect(readManifest(web).clips.map((clip) => clip.webEncodeKey)).toEqual([
      `v2/${HASH_A}.mp4`,
      expect.stringMatching(/^v1\//),
    ]);
  });

  it("refuses to run with an older encode version than the Library's", async () => {
    await run(await folderOf({ "M2U00001.MPG": "a" }), { encodeVersion: 2 });
    const manifestBefore = web.text(MANIFEST_KEY);

    const encoder = new FakeEncoder();
    await expect(
      run(await folderOf({ "M2U00002.MPG": "b" }), { encoder, encodeVersion: 1 }),
    ).rejects.toThrow(/encode version 2/);

    expect(encoder.encodes).toBe(0);
    expect(web.text(MANIFEST_KEY)).toBe(manifestBefore);
  });
});

describe("ingest: progress", () => {
  it("numbers each Original out of every Original found, counting ones already in the Library", async () => {
    await run(await folderOf({ "M2U00002.MPG": "b" }));
    log = new RecordingLog();

    await run(await folderOf({ "M2U00001.MPG": "a", "M2U00002.MPG": "b", "M2U00003.MPG": "bb" }));

    expect(log.infos).toEqual(["[1/3] adding M2U00001.MPG", "[3/3] adding M2U00003.MPG"]);
  });

  it("counts Originals skipped because their content is already in the Library", async () => {
    await run(await folderOf({ "M2U00002.MPG": "b" }));

    const result = await run(
      await folderOf({ "M2U00001.MPG": "a", "M2U00002.MPG": "b", "Copies/M2U00002.MPG": "b" }),
    );

    expect(result).toMatchObject({ added: 1, skipped: 2 });
  });

  it("numbers re-encodes separately", async () => {
    await run(await folderOf({ "M2U00001.MPG": "a", "M2U00002.MPG": "bb" }));
    log = new RecordingLog();

    await run(await folderOf({ "M2U00003.MPG": "b" }), { encodeVersion: 2 });

    expect(log.infos).toEqual([
      "[re-encode 1/2] re-encoding M2U00001.MPG",
      "[re-encode 2/2] re-encoding M2U00002.MPG",
      "[1/1] adding M2U00003.MPG",
    ]);
  });
});

describe("ingest: encode progress", () => {
  it("shows the encode's whole-number percentage, only when it changes", async () => {
    const encoder = new FakeEncoder();
    encoder.reports = [
      { encoded: 0.5, total: 10 },
      { encoded: 1, total: 10 },
      { encoded: 1.04, total: 10 },
      { encoded: 5, total: 10 },
      { encoded: 10.3, total: 10 },
    ];

    await run(await folderOf({ "M2U00001.MPG": "a" }), { encoder });

    expect(log.statuses).toEqual([
      "[1/1] encoding M2U00001.MPG 5%",
      "[1/1] encoding M2U00001.MPG 10%",
      "[1/1] encoding M2U00001.MPG 50%",
      "[1/1] encoding M2U00001.MPG 100%",
    ]);
  });

  it("shows how much has been encoded, in whole seconds, when the Original's duration is unknown", async () => {
    const encoder = new FakeEncoder();
    encoder.reports = [
      { encoded: 1.5, total: null },
      { encoded: 1.9, total: null },
      { encoded: 151, total: null },
    ];

    await run(await folderOf({ "M2U00001.MPG": "a" }), { encoder });

    expect(log.statuses).toEqual(["[1/1] encoding M2U00001.MPG 00:01", "[1/1] encoding M2U00001.MPG 02:31"]);
  });

  it("shows re-encodes' progress under their own counter", async () => {
    await run(await folderOf({ "M2U00001.MPG": "a" }));
    const encoder = new FakeEncoder("v2");
    encoder.reports = [{ encoded: 1, total: 4 }];

    await run(await folderOf({}), { encoder, encodeVersion: 2 });

    expect(log.statuses).toEqual(["[re-encode 1/1] encoding M2U00001.MPG 25%"]);
  });
});

describe("ingest: an unrecognised manifest", () => {
  it("refuses to touch a manifest of another format version", async () => {
    const future = JSON.stringify({ formatVersion: 2, scheduleEpoch: "2026-01-01T00:00:00Z", clips: [] });
    await web.writeText(MANIFEST_KEY, future, "application/json");

    await expect(run(await folderOf({ "M2U00001.MPG": "a" }))).rejects.toThrow(/format version 2/);

    expect(web.text(MANIFEST_KEY)).toBe(future);
    expect(originals.writes).toBe(0);
  });
});

describe("ingest: an Original that fails to encode", () => {
  it("is reported and left out, without blocking the rest of the batch", async () => {
    const failOn = (original: string) => {
      if (original === "corrupt") throw new Error("ffmpeg exited with code 1");
      return original.length;
    };
    const result = await run(await folderOf({ "M2U00001.MPG": "corrupt", "M2U00002.MPG": "b" }), {
      encoder: new FakeEncoder("web", failOn),
    });

    expect(readManifest(web).clips.map((clip) => clip.id)).toEqual([HASH_B]);
    expect(result.failed).toEqual(["M2U00001.MPG"]);
    expect(log.warnings.join("\n")).toContain("M2U00001.MPG");
    expect(log.warnings.join("\n")).toContain("ffmpeg exited with code 1");
  });
});

describe("ingest: Recording time", () => {
  it("decodes each sample Original's Recording time into the manifest", async () => {
    await run(fixtureOriginals());

    const recordingTimes = Object.fromEntries(
      readManifest(web).clips.map((clip) => [clip.originalFilename, clip.recordingTime]),
    );
    expect(recordingTimes).toEqual({
      "M2U00027.MPG": "2026-04-04T14:17:16",
      "M2U00036.MPG": "2026-04-05T13:19:29",
      "M2U00265.MPG": "2026-10-03T07:14:45",
    });
    expect(log.warnings).toEqual([]);
  });

  it("is null, with a warning, for an Original with no ARI_DATA packet; the Clip is still added", async () => {
    const result = await run(await folderOf({ "Malta/M2U00001.MPG": "a", "M2U00002.MPG": "b" }));

    expect(readManifest(web).clips.map((clip) => clip.recordingTime)).toEqual([null, null]);
    expect(result).toMatchObject({ added: 2, failed: [] });
    expect(log.warnings).toHaveLength(2);
    expect(log.warnings.join("\n")).toContain("Malta/M2U00001.MPG");
    expect(log.warnings.join("\n")).toContain("M2U00002.MPG");
    expect(log.warnings.every((warning) => warning.includes("Recording time"))).toBe(true);
  });

  it.each([
    ["a year before 2000", { year: 1999, month: 12, day: 31, hour: 23, minute: 59, second: 59 }],
    ["a year after 2100", { year: 2101, month: 1, day: 1, hour: 0, minute: 0, second: 0 }],
    ["a month that doesn't exist", { year: 2026, month: 13, day: 1, hour: 0, minute: 0, second: 0 }],
    ["a day the month doesn't have", { year: 2026, month: 2, day: 29, hour: 0, minute: 0, second: 0 }],
    ["an hour that doesn't exist", { year: 2026, month: 4, day: 4, hour: 24, minute: 0, second: 0 }],
  ])("is null, with a warning, for an ARI_DATA time with %s", async (_, time) => {
    const result = await run(await folderOf({ "M2U00001.MPG": originalRecordedAt(time) }));

    expect(readManifest(web).clips.map((clip) => clip.recordingTime)).toEqual([null]);
    expect(result).toMatchObject({ added: 1, failed: [] });
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]).toContain("M2U00001.MPG");
    expect(log.warnings[0]).toContain("implausible");
  });

  it("decodes a plausible ARI_DATA time, including a leap day", async () => {
    await run(
      await folderOf({
        "M2U00001.MPG": originalRecordedAt({ year: 2028, month: 2, day: 29, hour: 23, minute: 59, second: 58 }),
      }),
    );

    expect(readManifest(web).clips[0]?.recordingTime).toBe("2028-02-29T23:59:58");
  });
});

describe("ingest: the Library root", () => {
  let root: string;
  beforeEach(async () => {
    root = await folderOf({
      "M2U00000.MPG": "b",
      "Malta/M2U00001.MPG": "a",
      "Malta/Day 2/M2U00002.MPG": "bb",
    });
  });

  function runIn(root: string | undefined, path?: string) {
    return ingest(root, { originals, web, encoder: new FakeEncoder(), log, encodeVersion: 1, path });
  }
  const folders = () => readManifest(web).clips.map((clip) => [clip.folder, clip.originalFilename]);

  it("records folders relative to the Library root when ingesting a subfolder", async () => {
    await runIn(root, join(root, "Malta"));

    expect(folders()).toEqual([
      ["Malta/Day 2", "M2U00002.MPG"],
      ["Malta", "M2U00001.MPG"],
    ]);
  });

  it("resolves a relative path against the Library root, not the current directory", async () => {
    await runIn(root, "Malta/Day 2");

    expect(folders()).toEqual([["Malta/Day 2", "M2U00002.MPG"]]);
  });

  it("ingests the whole Library root when given no path, with \"\" for the root itself", async () => {
    await runIn(root);

    expect(folders()).toEqual([
      ["", "M2U00000.MPG"],
      ["Malta/Day 2", "M2U00002.MPG"],
      ["Malta", "M2U00001.MPG"],
    ]);
  });

  it("refuses a path that isn't a folder, publishing nothing", async () => {
    await expect(runIn(root, "Paris")).rejects.toThrow(/not a folder/);
    await expect(runIn(root, "M2U00000.MPG")).rejects.toThrow(/not a folder/);

    expect(web.writes).toBe(0);
  });

  it("refuses a missing Library root", async () => {
    await expect(runIn(undefined)).rejects.toThrow(/LIBRARY_ROOT/);
    await expect(runIn("")).rejects.toThrow(/LIBRARY_ROOT/);
  });

  it("refuses a symlink inside the root that points outside it", async () => {
    const elsewhere = await folderOf({ "M2U00001.MPG": "a" });
    await symlink(elsewhere, join(root, "Escape"));

    await expect(runIn(root, "Escape")).rejects.toThrow(/outside/);
    expect(web.writes).toBe(0);
  });

  it("accepts a path into the root spelled through a symlink to it", async () => {
    const link = join(await folderOf({}), "library-link");
    await symlink(root, link);

    await runIn(root, join(link, "Malta", "Day 2"));

    expect(folders()).toEqual([["Malta/Day 2", "M2U00002.MPG"]]);
  });

  it("records the folder's name as it is on disk, whatever case the path uses", async (context) => {
    // Only meaningful on a case-insensitive file system (macOS's default).
    if (!(await stat(join(root, "MALTA")).catch(() => null))) context.skip();

    await runIn(root, "malta/day 2");

    expect(folders()).toEqual([["Malta/Day 2", "M2U00002.MPG"]]);
  });

  it.each([
    ["an absolute path elsewhere", async () => folderOf({ "M2U00001.MPG": "a" })],
    ["a relative path climbing out", async () => ".."],
    [
      "a sibling sharing the root's name as a prefix",
      async () => {
        await mkdir(`${root}-copy`);
        return `${root}-copy`;
      },
    ],
  ])("refuses %s, archiving, encoding and publishing nothing", async (_, outside) => {
    const encoder = new FakeEncoder();
    await publishLibrary(web, [clipIn("", "M2U00009.MPG")], originals);
    const before = web.text(MANIFEST_KEY);

    await expect(
      ingest(root, { originals, web, encoder, log, encodeVersion: 2, path: await outside() }),
    ).rejects.toThrow(/outside/);

    expect(encoder.encodes).toBe(0);
    expect(originals.writes).toBe(0);
    expect(web.writes).toBe(0);
    expect(web.text(MANIFEST_KEY)).toBe(before);
  });
});

// Byte-level slices of real camcorder Originals (the first 64 packs, which
// hold the first ARI_DATA packet), committed so the tests run without the
// full-size Originals in assets/ (ADR 0005).
function fixtureOriginals(): string {
  return fileURLToPath(new URL("./fixtures/", import.meta.url));
}

// Warnings about skipped duplicate content (the fake Originals also draw
// no-Recording-time warnings).
function duplicateWarnings(): string[] {
  return log.warnings.filter((warning) => warning.startsWith("skipping"));
}
