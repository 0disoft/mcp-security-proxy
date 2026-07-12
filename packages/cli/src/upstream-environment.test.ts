import { describe, expect, it } from "vitest";
import { createUpstreamEnvironment } from "./upstream-environment.js";

describe("upstream environment", () => {
  it("omits unapproved parent environment values", () => {
    const environment = createUpstreamEnvironment(
      {
        PATH: "/safe/bin",
        TMPDIR: "/safe/tmp",
        SYNTHETIC_SECRET: "must-not-cross-the-boundary"
      },
      "linux"
    );

    expect(environment).toEqual({ PATH: "/safe/bin", TMPDIR: "/safe/tmp" });
    expect(environment).not.toHaveProperty("SYNTHETIC_SECRET");
  });

  it("preserves only process-launch essentials on Windows with case-insensitive lookup", () => {
    const environment = createUpstreamEnvironment(
      {
        Path: "C:\\safe\\bin",
        SYSTEMROOT: "C:\\Windows",
        USERPROFILE: "C:\\Users\\private"
      },
      "win32"
    );

    expect(environment).toMatchObject({ PATH: "C:\\safe\\bin", SystemRoot: "C:\\Windows" });
    expect(environment).not.toHaveProperty("USERPROFILE");
  });
});
