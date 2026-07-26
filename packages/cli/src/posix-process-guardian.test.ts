import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { spawnPosixGuardedUpstream } from "./posix-process-guardian.js";

describe("POSIX process guardian", () => {
  it("keeps startup data out of guardian argv and environment", async () => {
    const guardian = new FakeGuardian();
    const spawnGuardian = vi.fn(() => guardian);

    const upstream = spawnPosixGuardedUpstream(
      {
        executable: "/safe/bin/server",
        argv: ["--label", "private-marker"]
      },
      {
        PATH: "/safe/bin",
        TMPDIR: "/safe/tmp"
      },
      { shutdownGraceMs: 17 },
      {
        platform: "linux",
        spawnGuardian: spawnGuardian as unknown as typeof import("node:child_process").spawn,
        guardianEntryPath: "/package/dist/posix-process-guardian.js",
        nodeExecutable: "/runtime/node"
      }
    );

    const invocation = (
      spawnGuardian.mock.calls as unknown as Array<
        [
          string,
          string[],
          {
            detached: boolean;
            env: NodeJS.ProcessEnv;
            stdio: string[];
            windowsHide: boolean;
          }
        ]
      >
    )[0];
    expect(invocation).toEqual([
      "/runtime/node",
      ["/package/dist/posix-process-guardian.js"],
      {
        detached: true,
        env: {},
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      }
    ]);

    const controlLine = guardian.stdin.read()?.toString("utf8");
    expect(JSON.parse(controlLine ?? "{}")).toEqual({
      schemaVersion: "msp.posix-process-guardian.v1",
      executable: "/safe/bin/server",
      argv: ["--label", "private-marker"],
      environment: {
        PATH: "/safe/bin",
        TMPDIR: "/safe/tmp"
      },
      shutdownGraceMs: 17
    });
    expect(invocation?.[1].join(" ")).not.toContain("private-marker");
    expect(invocation?.[2].env).not.toHaveProperty("PATH");

    guardian.exitCode = 0;
    guardian.emit("exit", 0, null);
    await expect(upstream.exit).resolves.toBe(0);
  });

  it("refuses to create the POSIX guardian on Windows", () => {
    const spawnGuardian = vi.fn();

    expect(() =>
      spawnPosixGuardedUpstream(
        { executable: "server", argv: [] },
        {},
        { shutdownGraceMs: 1_000 },
        { platform: "win32", spawnGuardian }
      )
    ).toThrow("unavailable on Windows");
    expect(spawnGuardian).not.toHaveBeenCalled();
  });

  it("rejects oversized startup data before starting a guardian", () => {
    const spawnGuardian = vi.fn();

    expect(() =>
      spawnPosixGuardedUpstream(
        { executable: "server", argv: ["x".repeat(70_000)] },
        {},
        { shutdownGraceMs: 1_000 },
        { platform: "linux", spawnGuardian }
      )
    ).toThrow("control frame exceeds limit");
    expect(spawnGuardian).not.toHaveBeenCalled();
  });
});

class FakeGuardian extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4312;
  exitCode: number | null = null;
  readonly kill = vi.fn(() => true);
}
