import { describe, expect, it } from "vitest";

describe("shared module", () => {
  it("is importable", async () => {
    await expect(import("./index.ts")).resolves.toBeDefined();
  });
});
