import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runEntrypoint } from "./main.js";
import {
  decodeGuardianSource,
  establishWindowsKillOnCloseGuardian,
  resolveSystemPowerShell,
  WindowsProcessContainmentError
} from "./windows-job-guardian.js";

describe("Windows Job Object guardian", () => {
  it("does nothing outside Windows", async () => {
    const spawnGuardian = vi.fn();

    await establishWindowsKillOnCloseGuardian({ platform: "linux", spawnGuardian });

    expect(spawnGuardian).not.toHaveBeenCalled();
  });

  it("resolves system PowerShell without PATH lookup", () => {
    const fileExists = vi.fn(() => true);

    const executable = resolveSystemPowerShell({ SYSTEMROOT: "D:\\Windows" }, fileExists);

    expect(executable).toBe("D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(fileExists).toHaveBeenCalledWith(executable);
  });

  it("rejects a relative or missing system root", () => {
    expect(() => resolveSystemPowerShell({ SystemRoot: "windows" }, () => true)).toThrow(
      WindowsProcessContainmentError
    );
    expect(() => resolveSystemPowerShell({}, () => true)).toThrow(WindowsProcessContainmentError);
  });

  it("assigns the proxy through an encoded trusted command and a minimal environment", async () => {
    const guardian = new FakeGuardian();
    const spawnGuardian = vi.fn(() => guardian);
    const pending = establishWindowsKillOnCloseGuardian({
      platform: "win32",
      pid: 4312,
      environment: {
        SYSTEMROOT: "C:\\Windows",
        Temp: "C:\\Temp",
        SECRET_VALUE: "must-not-cross"
      },
      fileExists: () => true,
      spawnGuardian: spawnGuardian as unknown as typeof import("node:child_process").spawn
    });

    guardian.stdout.write("MSP_JOB_GUARDIAN_READY\r\n");
    await pending;

    const invocation = (
      spawnGuardian.mock.calls as unknown as Array<
        [
          string,
          string[],
          {
            env: NodeJS.ProcessEnv;
            stdio: string[];
            windowsHide: boolean;
          }
        ]
      >
    )[0];
    expect(invocation).toBeDefined();
    if (!invocation) {
      throw new Error("spawn invocation was not captured");
    }
    const [executable, argv, options] = invocation;
    expect(executable).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(argv.slice(0, -1)).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand"
    ]);
    const encodedCommand = argv.at(-1);
    expect(typeof encodedCommand).toBe("string");
    const source = decodeGuardianSource(encodedCommand as string);
    expect(source).toContain("CreateJobObject");
    expect(source).toContain("AssignProcessToJobObject");
    expect(source).toContain("0x00002000");
    expect(options).toMatchObject({
      env: {
        MSP_PROXY_PARENT_PID: "4312",
        SystemRoot: "C:\\Windows",
        TEMP: "C:\\Temp"
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    expect(options.env).not.toHaveProperty("SECRET_VALUE");
  });

  it("reports only a bounded guardian error code, not raw stderr", async () => {
    const guardian = new FakeGuardian();
    const pending = establishWindowsKillOnCloseGuardian({
      platform: "win32",
      pid: 7,
      environment: { SystemRoot: "C:\\Windows" },
      fileExists: () => true,
      spawnGuardian: (() => guardian) as unknown as typeof import("node:child_process").spawn
    });
    guardian.stderr.write("PRIVATE_PATH_MARKER\r\nMSP_JOB_GUARDIAN_ERROR:5\r\n");
    guardian.exitCode = 1;
    guardian.emit("exit", 1, null);

    await expect(pending).rejects.toThrow("guardian exited before readiness (code 5)");
    await expect(pending).rejects.not.toThrow("PRIVATE_PATH_MARKER");
  });

  it("fails run with exit 4 before invoking the CLI when containment setup fails", async () => {
    const runMain = vi.fn(async () => 0);
    const stderr = vi.fn();

    const exitCode = await runEntrypoint(["run", "--policy", "fixture.json"], {
      establishWindowsContainment: async () => {
        throw new WindowsProcessContainmentError("bounded containment failure");
      },
      runMain,
      stderr
    });

    expect(exitCode).toBe(4);
    expect(runMain).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith("bounded containment failure");
  });
});

class FakeGuardian extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  readonly kill = vi.fn(() => true);
}
