import { beforeEach, describe, expect, it } from "vitest";
import { list } from "./list.ts";
import { InMemoryBucket, clipIn, publishLibrary } from "./test-support.ts";

let web: InMemoryBucket;

beforeEach(() => {
  web = new InMemoryBucket();
});

describe("list", () => {
  it("shows each Clip's relative path, Recording time and duration", async () => {
    await publishLibrary(web, [
      clipIn("Malta/Day 1", "M2U00027.MPG", { recordingTime: "2026-04-04T14:17:16", duration: 65 }),
      clipIn("", "M2U00001.MPG", { recordingTime: null, duration: 3725 }),
    ]);

    expect(await list(web)).toEqual([
      "Malta/Day 1/M2U00027.MPG  2026-04-04 14:17:16     1:05",
      "M2U00001.MPG              (no Recording time)  1:02:05",
    ]);
  });

  it("narrows to Clips whose path contains the filter, ignoring case", async () => {
    await publishLibrary(web, [
      clipIn("Malta/Day 1", "M2U00027.MPG"),
      clipIn("Zoo", "M2U00028.MPG"),
      clipIn("", "M2U00029.MPG"),
    ]);

    const listed = await list(web, "malta");

    expect(listed).toHaveLength(1);
    expect(listed[0]).toContain("Malta/Day 1/M2U00027.MPG");
  });

  it("narrows to Clips whose Recording time contains the filter", async () => {
    await publishLibrary(web, [
      clipIn("", "M2U00001.MPG", { recordingTime: "2026-04-04T14:17:16" }),
      clipIn("", "M2U00002.MPG", { recordingTime: "2026-10-03T07:14:45" }),
      clipIn("", "M2U00003.MPG", { recordingTime: null }),
    ]);

    const listed = await list(web, "2026-04");

    expect(listed).toHaveLength(1);
    expect(listed[0]).toContain("M2U00001.MPG");
  });
});
