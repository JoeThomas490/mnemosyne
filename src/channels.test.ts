import { describe, expect, it } from "vitest";
import type { Clip } from "../shared/index.ts";
import committedConfig from "../channels.json";
import { channelClips, parseChannels, resolveChannel } from "./channels.ts";

describe("parsing the Channel config", () => {
  it("gives Channels in config order, defaulting to shuffled", () => {
    const channels = parseChannels([
      { id: "all", name: "All" },
      { id: "malta", name: "Malta", description: "Summer 2004", include: ["Malta"], order: "shuffled" },
    ]);

    expect(channels).toEqual([
      { id: "all", name: "All", order: "shuffled" },
      { id: "malta", name: "Malta", description: "Summer 2004", include: ["Malta"], order: "shuffled" },
    ]);
  });

  it.each([
    ["no Channels", []],
    ["not a list", { id: "all", name: "All" }],
    ["a duplicate id", [{ id: "all", name: "All" }, { id: "all", name: "Everything" }]],
    ["an id that isn't a slug", [{ id: "Malta 2004", name: "Malta" }]],
    ["a missing id", [{ name: "All" }]],
    ["a missing name", [{ id: "all" }]],
    ["an unknown order", [{ id: "all", name: "All", order: "alphabetical" }]],
    ["an include that isn't a list", [{ id: "malta", name: "Malta", include: "Malta" }]],
    ["an include entry that isn't a string", [{ id: "malta", name: "Malta", include: ["Malta", 2004] }]],
    ["a description that isn't a string", [{ id: "all", name: "All", description: 1 }]],
  ])("rejects %s", (_, config) => {
    expect(() => parseChannels(config)).toThrow();
  });

  it("accepts the committed config, which has only All, airing the whole Library", () => {
    expect(parseChannels(committedConfig)).toEqual([{ id: "all", name: "All", order: "shuffled" }]);
  });
});

describe("resolving ?channel=", () => {
  const channels = parseChannels([
    { id: "all", name: "All" },
    { id: "malta", name: "Malta", include: ["Malta"] },
  ]);

  it("gives the Channel with that id", () => {
    expect(resolveChannel(channels, "malta").id).toBe("malta");
  });

  it("gives the default (first) Channel for an unknown id", () => {
    expect(resolveChannel(channels, "nowhere").id).toBe("all");
  });

  it("gives the default (first) Channel when none is named", () => {
    expect(resolveChannel(channels, null).id).toBe("all");
  });
});

describe("a Channel's Clips", () => {
  const clipIn = (folder: string, id: string): Clip => ({
    id,
    webEncodeKey: `v1/${id}.mp4`,
    duration: 10,
    recordingTime: null,
    folder,
    originalFilename: `${id}.MPG`,
  });
  const library = [
    clipIn("", "root"),
    clipIn("Malta", "malta"),
    clipIn("Malta/Day 2", "day2"),
    clipIn("Maltese", "maltese"),
    clipIn("Paris", "paris"),
  ];
  const ids = (include?: string[]) =>
    channelClips(parseChannels([{ id: "c", name: "C", ...(include && { include }) }])[0], library).map(
      (clip) => clip.id,
    );

  it("are the whole Library when the Channel has no include", () => {
    expect(ids()).toEqual(["root", "malta", "day2", "maltese", "paris"]);
  });

  it("are those in an included folder and the folders beneath it, not sibling prefixes", () => {
    expect(ids(["Malta"])).toEqual(["malta", "day2"]);
  });

  it("are those in any of several included folders, in Library order", () => {
    expect(ids(["Paris", "Malta/Day 2"])).toEqual(["day2", "paris"]);
  });

  it("are the whole Library when the root is included", () => {
    expect(ids([""])).toEqual(["root", "malta", "day2", "maltese", "paris"]);
  });

  it("are none when no folder matches", () => {
    expect(ids(["Tokyo"])).toEqual([]);
  });
});
