import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { MANIFEST_KEY, type Manifest } from "../../shared/index.ts";
import { ingest } from "./ingest.ts";
import {
  FakeEncoder,
  InMemoryBucket,
  RecordingLog,
  folderOf,
  originalRecordedAt,
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

    const manifest = readManifest();
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

    expect(readManifest().clips.map((clip) => clip.originalFilename)).toEqual([
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
    const epoch = readManifest().scheduleEpoch;

    const encoder = new FakeEncoder();
    await run(await folderOf({ "M2U00001.MPG": "a", "M2U00002.MPG": "b" }), { encoder });

    expect(encoder.encodes).toBe(1);
    expect(readManifest().clips.map((clip) => clip.id)).toEqual([HASH_A, HASH_B]);
    expect(readManifest().scheduleEpoch).toBe(epoch);
  });

  it("keeps Clips whose Originals are absent locally", async () => {
    await run(await folderOf({ "Malta/M2U00001.MPG": "a" }));

    await run(await folderOf({ "M2U00002.MPG": "b" }));

    const clips = readManifest().clips;
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

    expect(readManifest().scheduleEpoch).toBe("2025-06-01T00:00:00Z");
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
    expect(readManifest().clips).toHaveLength(1);
    expect(readManifest().clips[0]).toMatchObject({ folder: "Malta", originalFilename: "M2U00001.MPG" });
    const skipped = duplicateWarnings();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toContain("Zoo/M2U00007.MPG");
    expect(skipped[0]).toContain("Malta/M2U00001.MPG");
  });

  it("warns when content already in the Library turns up somewhere else", async () => {
    await run(await folderOf({ "Malta/M2U00001.MPG": "a" }));

    log = new RecordingLog();
    await run(await folderOf({ "Copies/M2U00001.MPG": "a" }));

    expect(readManifest().clips[0]).toMatchObject({ folder: "Malta" });
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
    expect(readManifest().clips).toEqual([
      expect.objectContaining({ id: HASH_BB, webEncodeKey: `v2/${HASH_BB}.mp4`, folder: "" }),
      expect.objectContaining({ id: HASH_A, webEncodeKey: `v2/${HASH_A}.mp4`, folder: "Malta" }),
    ]);
  });

  it("takes each re-encoded Clip's duration from its new encode", async () => {
    await run(await folderOf({ "M2U00001.MPG": "bb" }));

    await run(await folderOf({}), { encoder: new FakeEncoder("v2", () => 99), encodeVersion: 2 });

    expect(readManifest().clips[0]?.duration).toBe(99);
  });

  it("encodes new Originals straight to the new version", async () => {
    await run(await folderOf({ "M2U00001.MPG": "a" }));

    await run(await folderOf({ "M2U00002.MPG": "b" }), { encodeVersion: 2 });

    expect(readManifest().clips.map((clip) => clip.webEncodeKey)).toEqual([
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
    expect(readManifest().clips.map((clip) => clip.webEncodeKey)).toEqual([
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

    expect(readManifest().clips.map((clip) => clip.id)).toEqual([HASH_B]);
    expect(result.failed).toEqual(["M2U00001.MPG"]);
    expect(log.warnings.join("\n")).toContain("M2U00001.MPG");
    expect(log.warnings.join("\n")).toContain("ffmpeg exited with code 1");
  });
});

describe("ingest: Recording time", () => {
  it("decodes each sample Original's Recording time into the manifest", async () => {
    await run(sampleOriginals());

    const recordingTimes = Object.fromEntries(
      readManifest().clips.map((clip) => [clip.originalFilename, clip.recordingTime]),
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

    expect(readManifest().clips.map((clip) => clip.recordingTime)).toEqual([null, null]);
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

    expect(readManifest().clips.map((clip) => clip.recordingTime)).toEqual([null]);
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

    expect(readManifest().clips[0]?.recordingTime).toBe("2028-02-29T23:59:58");
  });
});

// The real camcorder Originals in assets/ (too large to commit, so they
// must be copied in by hand before running the tests).
const SAMPLE_ORIGINALS = ["M2U00027.MPG", "M2U00036.MPG", "M2U00265.MPG"];

function sampleOriginals(): string {
  const assets = fileURLToPath(new URL("../../assets/", import.meta.url));
  const missing = SAMPLE_ORIGINALS.filter((name) => !existsSync(assets + name));
  if (missing.length > 0) {
    throw new Error(
      `missing sample Originals in assets/: ${missing.join(", ")}. ` +
        "They aren't committed; copy them in from the camcorder footage.",
    );
  }
  return assets;
}

// Warnings about skipped duplicate content (the fake Originals also draw
// no-Recording-time warnings).
function duplicateWarnings(): string[] {
  return log.warnings.filter((warning) => warning.startsWith("skipping"));
}

function readManifest(): Manifest {
  const text = web.text(MANIFEST_KEY);
  if (text === undefined) throw new Error("no manifest was published");
  return JSON.parse(text);
}
