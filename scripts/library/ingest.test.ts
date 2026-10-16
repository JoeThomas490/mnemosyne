import { beforeEach, describe, expect, it } from "vitest";
import { MANIFEST_KEY, type Manifest } from "../../shared/index.ts";
import { ingest } from "./ingest.ts";
import { FakeEncoder, InMemoryBucket, RecordingLog, folderOf } from "./test-support.ts";

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
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]).toContain("Zoo/M2U00007.MPG");
    expect(log.warnings[0]).toContain("Malta/M2U00001.MPG");
  });

  it("warns when content already in the Library turns up somewhere else", async () => {
    await run(await folderOf({ "Malta/M2U00001.MPG": "a" }));

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

function readManifest(): Manifest {
  const text = web.text(MANIFEST_KEY);
  if (text === undefined) throw new Error("no manifest was published");
  return JSON.parse(text);
}
