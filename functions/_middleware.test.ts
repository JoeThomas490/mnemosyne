import { describe, expect, it } from "vitest";
import { onRequest } from "./_middleware.ts";
import { context } from "./test-support.ts";

const page = (headers?: HeadersInit) => new Request("https://example.test/", { headers });

describe("access policy: open", () => {
  it("serves requests without credentials", async () => {
    const response = await onRequest(context(page(), { ACCESS_POLICY: "open" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("next");
  });
});

describe("access policy: password", () => {
  const env = { ACCESS_POLICY: "password", BASIC_AUTH_USER: "joe", BASIC_AUTH_PASSWORD: "s3cret" };
  // Encodes as UTF-8, as the challenge's charset="UTF-8" asks browsers to.
  const basic = (user: string, password: string) => {
    const bytes = new TextEncoder().encode(`${user}:${password}`);
    return { Authorization: `Basic ${btoa(String.fromCharCode(...bytes))}` };
  };

  it("challenges requests without credentials", async () => {
    const response = await onRequest(context(page(), env));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toMatch(/^Basic realm=/);
  });

  it("guards media as well as the page", async () => {
    const request = new Request("https://example.test/media/manifest.json");
    expect((await onRequest(context(request, env))).status).toBe(401);
    const authorised = new Request(request, { headers: basic("joe", "s3cret") });
    expect((await onRequest(context(authorised, env))).status).toBe(200);
  });

  it("rejects the wrong password", async () => {
    const response = await onRequest(context(page(basic("joe", "nope")), env));
    expect(response.status).toBe(401);
  });

  it("rejects the wrong user", async () => {
    const response = await onRequest(context(page(basic("bob", "s3cret")), env));
    expect(response.status).toBe(401);
  });

  it("rejects a malformed Authorization header", async () => {
    const response = await onRequest(context(page({ Authorization: "Basic !!!" }), env));
    expect(response.status).toBe(401);
  });

  it("serves requests with the correct credentials", async () => {
    const response = await onRequest(context(page(basic("joe", "s3cret")), env));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("next");
  });

  it("accepts passwords containing colons", async () => {
    const response = await onRequest(
      context(page(basic("joe", "a:b")), { ...env, BASIC_AUTH_PASSWORD: "a:b" }),
    );
    expect(response.status).toBe(200);
  });

  it("accepts non-ASCII passwords", async () => {
    const response = await onRequest(
      context(page(basic("joe", "pässwörd🎞")), { ...env, BASIC_AUTH_PASSWORD: "pässwörd🎞" }),
    );
    expect(response.status).toBe(200);
  });

  it("rejects everything when the credentials secrets are unset", async () => {
    const response = await onRequest(
      context(page(basic("", "")), { ACCESS_POLICY: "password" }),
    );
    expect(response.status).toBe(401);
  });
});

describe("access policy: misconfigured", () => {
  it("fails closed on an unknown policy", async () => {
    const response = await onRequest(context(page(), { ACCESS_POLICY: "opne" }));
    expect(response.status).toBe(500);
  });
});
