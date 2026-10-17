import { describe, expect, it } from "vitest";
import { encodedSecondsFrom } from "./ffmpeg-encoder.ts";

describe("encodedSecondsFrom: a line of ffmpeg's -progress output", () => {
  it("reads the seconds encoded so far from out_time_us", () => {
    expect(encodedSecondsFrom("out_time_us=151480000")).toBe(151.48);
  });

  it("ignores out_time_us before ffmpeg knows it", () => {
    expect(encodedSecondsFrom("out_time_us=N/A")).toBeNull();
  });

  it.each(["frame=3787", "out_time=00:02:31.480000", "progress=continue", ""])("ignores %j", (line) => {
    expect(encodedSecondsFrom(line)).toBeNull();
  });
});
