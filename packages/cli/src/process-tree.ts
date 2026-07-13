import { spawn, type ChildProcess } from "node:child_process";

interface TerminableChild {
  readonly pid?: number | undefined;
  readonly exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
}

interface ProcessTreeTerminationDependencies {
  readonly platform?: NodeJS.Platform;
  readonly runCommand?: (command: string, argv: readonly string[]) => Promise<void>;
  readonly killProcessGroup?: (pid: number, signal: NodeJS.Signals) => void;
}

export function createProcessTreeTerminator(
  child: TerminableChild,
  dependencies: ProcessTreeTerminationDependencies = {}
): (force?: boolean) => Promise<void> {
  const platform = dependencies.platform ?? process.platform;
  const runCommand = dependencies.runCommand ?? runTerminationCommand;
  const killProcessGroup = dependencies.killProcessGroup ?? defaultKillProcessGroup;

  return async (force = false): Promise<void> => {
    if (child.exitCode !== null) {
      return;
    }
    const signal: NodeJS.Signals = force ? "SIGKILL" : "SIGTERM";
    const pid = child.pid;
    if (!pid) {
      child.kill(signal);
      return;
    }

    if (platform === "win32") {
      try {
        await runCommand("taskkill.exe", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])]);
        return;
      } catch {
        if (child.exitCode === null) {
          child.kill(signal);
        }
        return;
      }
    }

    try {
      killProcessGroup(pid, signal);
    } catch {
      if (child.exitCode === null) {
        child.kill(signal);
      }
    }
  };
}

export function shouldCreateProcessGroup(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32";
}

function defaultKillProcessGroup(pid: number, signal: NodeJS.Signals): void {
  process.kill(-pid, signal);
}

function runTerminationCommand(command: string, argv: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const commandProcess = spawn(command, argv, {
      stdio: "ignore",
      windowsHide: true
    });
    const timeout = setTimeout(() => {
      commandProcess.kill("SIGKILL");
      reject(new Error(`${command} timed out`));
    }, 2_000);
    commandProcess.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    commandProcess.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? 1}`));
      }
    });
  });
}

export type SpawnedUpstreamChild = Pick<ChildProcess, "pid" | "exitCode" | "kill">;
