import { beforeEach, describe, expect, it } from "vitest";
import { onRequest } from "./[[path]].ts";
import { FakeBucket, context } from "../test-support.ts";

let bucket: FakeBucket;

beforeEach(() => {
  bucket = new FakeBucket();
  bucket.put("v1/abc.mp4", "0123456789", "video/mp4");
});

function media(path: string, headers?: HeadersInit, method = "GET") {
  const request = new Request(`https://example.test/media/${path}`, { headers, method });
  return onRequest(context(request, { WEB: bucket.asR2() }));
}

describe("media route: full requests", () => {
  it("serves the whole object with 200", async () => {
    const response = await media("v1/abc.mp4");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("0123456789");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
  });

  it("returns 404 for a missing object", async () => {
    const response = await media("v1/missing.mp4");
    expect(response.status).toBe(404);
  });

  it("returns 404 for a malformed path", async () => {
    const response = await media("v1/%E0%A4");
    expect(response.status).toBe(404);
  });

  it("answers HEAD with the headers of a GET", async () => {
    const response = await media("v1/abc.mp4", undefined, "HEAD");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("10");
  });

  it("refuses methods other than GET and HEAD", async () => {
    const response = await media("v1/abc.mp4", undefined, "POST");
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET, HEAD");
  });
});

describe("media route: Range requests", () => {
  it.each([
    ["bytes=2-5", "2345", "bytes 2-5/10"],
    ["bytes=7-", "789", "bytes 7-9/10"],
    ["bytes=-3", "789", "bytes 7-9/10"],
    ["bytes=8-100", "89", "bytes 8-9/10"],
    ["bytes=-50", "0123456789", "bytes 0-9/10"],
  ])("serves %s as 206 partial content", async (range, body, contentRange) => {
    const response = await media("v1/abc.mp4", { Range: range });
    expect(response.status).toBe(206);
    expect(await response.text()).toBe(body);
    expect(response.headers.get("Content-Range")).toBe(contentRange);
    expect(response.headers.get("Content-Length")).toBe(String(body.length));
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Type")).toBe("video/mp4");
  });

  it.each(["bytes=10-", "bytes=20-30", "bytes=-0"])(
    "rejects unsatisfiable %s with 416",
    async (range) => {
      const response = await media("v1/abc.mp4", { Range: range });
      expect(response.status).toBe(416);
      expect(response.headers.get("Content-Range")).toBe("bytes */10");
    },
  );

  it.each(["bytes=5-2", "items=0-1", "bytes=0-1,4-5"])(
    "ignores a Range it doesn't support (%s) and serves the whole object",
    async (range) => {
      const response = await media("v1/abc.mp4", { Range: range });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("0123456789");
    },
  );

  it("returns 404 for a Range on a missing object", async () => {
    const response = await media("v1/missing.mp4", { Range: "bytes=0-1" });
    expect(response.status).toBe(404);
  });
});

describe("media route: the manifest", () => {
  beforeEach(() => bucket.put("manifest.json", '{"formatVersion":1}', "application/json"));

  it("is served with an ETag and must be revalidated before reuse", async () => {
    const response = await media("manifest.json");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"formatVersion":1}');
    expect(response.headers.get("ETag")).toMatch(/^".+"$/);
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("returns 304 with no body for a matching If-None-Match", async () => {
    const etag = (await media("manifest.json")).headers.get("ETag")!;
    const response = await media("manifest.json", { "If-None-Match": etag });
    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe(etag);
    expect(await response.text()).toBe("");
  });

  it("matches weak validators and lists of ETags", async () => {
    const etag = (await media("manifest.json")).headers.get("ETag")!;
    const response = await media("manifest.json", { "If-None-Match": `"other", W/${etag}` });
    expect(response.status).toBe(304);
  });

  it("serves the new manifest once it has changed", async () => {
    const etag = (await media("manifest.json")).headers.get("ETag")!;
    bucket.put("manifest.json", '{"formatVersion":2}', "application/json");
    const response = await media("manifest.json", { "If-None-Match": etag });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"formatVersion":2}');
    expect(response.headers.get("ETag")).not.toBe(etag);
  });
});
