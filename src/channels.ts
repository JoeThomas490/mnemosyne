// Channels (ADR 0006): the owner's lineup, defined in `channels.json` at the
// repo root. This parses and validates that config, resolves the Channel a
// viewer asked for, and picks a Channel's Clips from the Library. Pure: no
// I/O.
import type { Clip } from "../shared/index.ts";

export type ChannelOrder = "shuffled";
const CHANNEL_ORDERS: readonly ChannelOrder[] = ["shuffled"];

// One entry in `channels.json`, with defaults applied. The config's order
// gives the Channel numbers and the first entry is the default Channel.
export interface Channel {
  // Slug used in `?channel=`; stable across renames.
  id: string;
  name: string;
  // Stored, not shown.
  description?: string;
  // Folders relative to the Library root whose Clips (including those in
  // folders beneath them) the Channel airs; absent means the whole Library.
  include?: string[];
  order: ChannelOrder;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Validates the Channel config, throwing on anything invalid so a bad edit
// fails the build rather than reaching the site.
export function parseChannels(config: unknown): Channel[] {
  if (!Array.isArray(config) || config.length === 0) {
    throw new Error("Channel config must be a non-empty list of Channels");
  }
  const ids = new Set<string>();
  return config.map((entry: unknown, index) => {
    const fail = (problem: string): never => {
      throw new Error(`Channel ${index + 1} in the Channel config ${problem}`);
    };
    if (typeof entry !== "object" || entry === null) return fail("isn't an object");
    const { id, name, description, include, order = "shuffled" } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !SLUG.test(id)) fail('needs an "id" that is a lowercase slug, e.g. "malta"');
    if (ids.has(id as string)) fail(`has the same id as another Channel: "${id}"`);
    ids.add(id as string);
    if (typeof name !== "string") fail('needs a "name"');
    if (description !== undefined && typeof description !== "string") fail('has a "description" that isn\'t text');
    if (include !== undefined && !(Array.isArray(include) && include.every((folder) => typeof folder === "string"))) {
      fail('has an "include" that isn\'t a list of folders');
    }
    if (!CHANNEL_ORDERS.includes(order as ChannelOrder)) fail(`has an unknown "order": "${order}"`);
    return {
      id: id as string,
      name: name as string,
      ...(description !== undefined && { description: description as string }),
      ...(include !== undefined && { include: include as string[] }),
      order: order as ChannelOrder,
    };
  });
}

// The Channel `?channel=` names, or the default Channel when it names none
// or one that doesn't exist.
export function resolveChannel(channels: readonly Channel[], id: string | null): Channel {
  return channels.find((channel) => channel.id === id) ?? channels[0];
}

// The Clips `channel` airs, in Library order: those in its included
// folders or beneath them (so "Malta" covers "Malta/Day 2" but not
// "Maltese"), or every Clip when it has no `include`. "" is the root.
export function channelClips(channel: Channel, clips: readonly Clip[]): Clip[] {
  const { include } = channel;
  if (!include) return [...clips];
  return clips.filter((clip) => include.some((folder) => inFolder(clip.folder, folder)));
}

function inFolder(clipFolder: string, folder: string): boolean {
  return folder === "" || clipFolder === folder || clipFolder.startsWith(`${folder}/`);
}
