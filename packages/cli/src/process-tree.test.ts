import { describe, expect, it, vi } from "vitest";
import { createProcessTreeTerminator, shouldCreateProcessGroup } from "./process-tree.js";

describe("process tree termination", () => {
  it("uses taskkill tree mode on Windows and adds force only for escalation", async () => {
    const runCommand = vi.fn(async () => undefined);
    const child = fakeChild(4312);
    const terminate = createProcessTreeTerminator(child, { platform: "win32", runCommand });

    await terminate(false);
    await terminate(true);

    expect(runCommand).toHaveBeenNthCalledWith(1, "taskkill.exe", ["/PID", "4312", "/T"]);
    expect(runCommand).toHaveBeenNthCalledWith(2, "taskkill.exe", ["/PID", "4312", "/T", "/F"]);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("signals the dedicated POSIX process group", async () => {
    const killProcessGroup = vi.fn();
    const child = fakeChild(77);
    const terminate = createProcessTreeTerminator(child, { platform: "linux", killProcessGroup });

    await terminate(false);
    await terminate(true);

    expect(killProcessGroup).toHaveBeenNthCalledWith(1, 77, "SIGTERM");
    expect(killProcessGroup).toHaveBeenNthCalledWith(2, 77, "SIGKILL");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("falls back to direct child termination when tree termination fails", async () => {
    const child = fakeChild(99);
    const terminate = createProcessTreeTerminator(child, {
      platform: "win32",
      runCommand: async () => {
        throw new Error("taskkill unavailable");
      }
    });

    await terminate(true);

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("does not target a PID after the child has exited", async () => {
    const runCommand = vi.fn(async () => undefined);
    const child = fakeChild(123, 0);
    const terminate = createProcessTreeTerminator(child, { platform: "win32", runCommand });

    await terminate(true);

    expect(runCommand).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("creates dedicated process groups only where negative PID signaling is supported", () => {
    expect(shouldCreateProcessGroup("linux")).toBe(true);
    expect(shouldCreateProcessGroup("darwin")).toBe(true);
    expect(shouldCreateProcessGroup("win32")).toBe(false);
  });
});

function fakeChild(pid: number, exitCode: number | null = null) {
  return {
    pid,
    exitCode,
    kill: vi.fn(() => true)
  };
}
