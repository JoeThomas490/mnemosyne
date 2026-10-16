// Serves web encodes and the manifest from the private `mnemosyne-web` bucket
// on the site's own origin (ADR 0002): /media/<key> → object <key>. Honours single
// byte-range requests so a viewer can Tune in mid-Clip without downloading
// the whole object, and conditional requests so the frontend can cheaply
// re-check the manifest at every Clip boundary.
import { MANIFEST_KEY } from "../../shared/index.ts";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const key = objectKey(request);
  if (!key) return notFound();

  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch) {
    const head = await env.WEB.head(key);
    if (!head) return notFound();
    if (etagMatches(ifNoneMatch, head.httpEtag)) {
      return new Response(null, { status: 304, headers: cacheHeaders(head) });
    }
  }

  const range = parseRange(request.headers.get("Range"));
  if (!range) {
    const object = await env.WEB.get(key);
    if (!object) return notFound();
    return new Response(object.body, {
      status: 200,
      headers: objectHeaders(object, object.size),
    });
  }

  // The object's size is needed to resolve the range before fetching it.
  const head = await env.WEB.head(key);
  if (!head) return notFound();
  const span = resolveRange(range, head.size);
  if (!span) {
    return new Response("Range not satisfiable", {
      status: 416,
      headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${head.size}` },
    });
  }

  const object = await env.WEB.get(key, { range: span });
  if (!object) return notFound();
  const last = span.offset + span.length - 1;
  const headers = objectHeaders(object, span.length);
  headers.set("Content-Range", `bytes ${span.offset}-${last}/${object.size}`);
  return new Response(object.body, { status: 206, headers });
};

// The object key the request names, or "" when there isn't a usable one.
function objectKey(request: Request): string {
  try {
    return decodeURIComponent(new URL(request.url).pathname.replace(/^\/media\//, ""));
  } catch {
    return "";
  }
}

function objectHeaders(object: R2Object, contentLength: number): Headers {
  const headers = cacheHeaders(object);
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(contentLength));
  return headers;
}

function cacheHeaders(object: R2Object): Headers {
  const headers = new Headers({ ETag: object.httpEtag });
  // The manifest changes whenever the Library does, so clients must
  // revalidate it (cheaply, via its ETag) rather than reuse a stale copy.
  if (object.key === MANIFEST_KEY) headers.set("Cache-Control", "no-cache");
  return headers;
}

// If-None-Match uses weak comparison: `W/` prefixes are ignored.
function etagMatches(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === "*") return true;
  const strip = (tag: string) => tag.trim().replace(/^W\//, "");
  return ifNoneMatch.split(",").some((tag) => strip(tag) === strip(etag));
}

type RequestedRange = { start: number; end?: number } | { suffix: number };

// Parses a single `bytes=` range. Anything else (other units, multiple
// ranges, malformed syntax) yields null, and the Range header is ignored
// as RFC 9110 allows, serving the whole object.
function parseRange(header: string | null): RequestedRange | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, first, last] = match;
  if (first === "") return last === "" ? null : { suffix: Number(last) };
  const start = Number(first);
  if (last === "") return { start };
  const end = Number(last);
  return end < start ? null : { start, end };
}

// Clamps a requested range to the object, or returns null when no byte of
// it exists (→ 416).
function resolveRange(
  range: RequestedRange,
  size: number,
): { offset: number; length: number } | null {
  if ("suffix" in range) {
    if (range.suffix === 0 || size === 0) return null;
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  if (range.start >= size) return null;
  const end = Math.min(range.end ?? size - 1, size - 1);
  return { offset: range.start, length: end - range.start + 1 };
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
