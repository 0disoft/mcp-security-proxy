import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { UpstreamCommand, UpstreamProcess, UpstreamSpawnContext } from "@0disoft/mcp-security-proxy-runtime";
import { createProcessTreeTerminator } from "./process-tree.js";

const controlSchemaVersion = "msp.posix-process-guardian.v1";
const maximumControlFrameBytes = 65_536;
const forceTerminationDelayMs = 250;

interface PosixGuardianControlFrame {
  readonly schemaVersion: typeof controlSchemaVersion;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly environment: Readonly<Record<string, string>>;
  readonly shutdownGraceMs: number;
}

interface PosixGuardianDependencies {
  readonly platform?: NodeJS.Platform;
  readonly spawnGuardian?: typeof spawn;
  readonly guardianEntryPath?: string;
  readonly nodeExecutable?: string;
}

export function spawnPosixGuardedUpstream(
  command: UpstreamCommand,
  environment: NodeJS.ProcessEnv,
  context: UpstreamSpawnContext,
  dependencies: PosixGuardianDependencies = {}
): UpstreamProcess {
  const platform = dependencies.platform ?? process.platform;
  if (platform === "win32") {
    throw new Error("POSIX process guardian is unavailable on Windows");
  }

  const controlFrame = serializeControlFrame(command, environment, context.shutdownGraceMs);
  const spawnGuardian = dependencies.spawnGuardian ?? spawn;
  const guardian = spawnGuardian(
    dependencies.nodeExecutable ?? process.execPath,
    [dependencies.guardianEntryPath ?? fileURLToPath(import.meta.url)],
    {
      detached: true,
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );

  if (!guardian.stdin || !guardian.stdout || !guardian.stderr) {
    guardian.kill("SIGKILL");
    throw new Error("failed to create POSIX process guardian pipes");
  }

  guardian.stdin.on("error", () => undefined);
  guardian.stdin.write(controlFrame);

  return {
    stdin: guardian.stdin,
    stdout: guardian.stdout,
    stderr: guardian.stderr,
    exit: waitForChildExit(guardian),
    kill: createProcessTreeTerminator(guardian, { platform })
  };
}

export async function runPosixProcessGuardian(): Promise<number> {
  if (process.platform === "win32") {
    return 1;
  }

  let startup: GuardianStartup;
  try {
    startup = await readControlFrame(process.stdin);
  } catch {
    writeGuardianDiagnostic("invalid control frame");
    return 1;
  }

  let upstream: ChildProcess;
  try {
    upstream = spawn(startup.control.executable, [...startup.control.argv], {
      detached: true,
      env: startup.control.environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
  } catch {
    writeGuardianDiagnostic("upstream startup failed");
    return 1;
  }

  if (!upstream.stdin || !upstream.stdout || !upstream.stderr) {
    upstream.kill("SIGKILL");
    writeGuardianDiagnostic("upstream pipes unavailable");
    return 1;
  }
  const upstreamInput = upstream.stdin;

  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let forceCleanup: Promise<void> | undefined;
  let resolveForceCleanup: (() => void) | undefined;
  let terminationStarted = false;
  let upstreamExited = false;
  let parentInputClosed = false;

  const signalUpstreamProcessGroup = (signal: NodeJS.Signals): void => {
    const pid = upstream.pid;
    if (!pid) {
      if (!upstreamExited) {
        upstream.kill(signal);
      }
      return;
    }
    try {
      process.kill(-pid, signal);
    } catch {
      if (!upstreamExited) {
        upstream.kill(signal);
      }
    }
  };
  const scheduleForceTermination = (): void => {
    if (!forceTimer) {
      forceCleanup = new Promise((resolve) => {
        resolveForceCleanup = resolve;
      });
      forceTimer = setTimeout(() => {
        signalUpstreamProcessGroup("SIGKILL");
        resolveForceCleanup?.();
      }, forceTerminationDelayMs);
    }
  };
  const terminateUpstreamProcessGroup = (): void => {
    if (terminationStarted) {
      return;
    }
    terminationStarted = true;
    signalUpstreamProcessGroup("SIGTERM");
    scheduleForceTermination();
  };
  const handleTerminationSignal = (): void => terminateUpstreamProcessGroup();
  const scheduleShutdown = (): void => {
    if (shutdownTimer || terminationStarted || upstreamExited) {
      return;
    }
    shutdownTimer = setTimeout(terminateUpstreamProcessGroup, startup.control.shutdownGraceMs);
  };

  process.on("SIGTERM", handleTerminationSignal);
  process.stdout.on("error", scheduleShutdown);
  process.stderr.on("error", scheduleShutdown);
  upstream.stdout.pipe(process.stdout, { end: false });
  upstream.stderr.pipe(process.stderr, { end: false });

  const inputForwarding = forwardClientInput(startup, upstreamInput, () => {
    parentInputClosed = true;
    scheduleShutdown();
  })
    .catch(() => undefined)
    .finally(() => {
      if (!upstreamInput.destroyed && !upstreamInput.writableEnded) {
        upstreamInput.end();
      }
    });

  const exitCode = await waitForChildExit(upstream).catch(() => 1);
  upstreamExited = true;
  process.stdin.destroy();
  await inputForwarding;
  if (parentInputClosed || terminationStarted || shutdownTimer) {
    terminateUpstreamProcessGroup();
    await forceCleanup;
  }
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
  }
  if (forceTimer) {
    clearTimeout(forceTimer);
  }
  process.off("SIGTERM", handleTerminationSignal);
  process.stdin.destroy();
  return exitCode;
}

interface GuardianStartup {
  readonly control: PosixGuardianControlFrame;
  readonly remainingInput: Buffer;
  readonly iterator: AsyncIterator<Buffer | string>;
}

async function readControlFrame(input: NodeJS.ReadStream): Promise<GuardianStartup> {
  const iterator = input[Symbol.asyncIterator]() as AsyncIterator<Buffer | string>;
  let buffered = Buffer.alloc(0);

  while (true) {
    const next = await iterator.next();
    if (next.done) {
      throw new Error("control frame ended before delimiter");
    }
    const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    buffered = Buffer.concat([buffered, chunk]);
    const delimiter = buffered.indexOf(0x0a);
    if (delimiter < 0) {
      if (buffered.byteLength > maximumControlFrameBytes) {
        throw new Error("control frame exceeds limit");
      }
      continue;
    }
    if (delimiter > maximumControlFrameBytes) {
      throw new Error("control frame exceeds limit");
    }

    const line = new TextDecoder("utf-8", { fatal: true }).decode(buffered.subarray(0, delimiter)).replace(/\r$/u, "");
    return {
      control: parseControlFrame(line),
      remainingInput: buffered.subarray(delimiter + 1),
      iterator
    };
  }
}

async function forwardClientInput(
  startup: GuardianStartup,
  destination: NodeJS.WritableStream,
  onInputClosed: () => void
): Promise<void> {
  if (startup.remainingInput.byteLength > 0) {
    await writeChunk(destination, startup.remainingInput);
  }
  while (true) {
    const next = await startup.iterator.next();
    if (next.done) {
      onInputClosed();
      return;
    }
    await writeChunk(destination, next.value);
  }
}

function writeChunk(destination: NodeJS.WritableStream, chunk: Buffer | string): Promise<void> {
  return new Promise((resolve, reject) => {
    destination.write(chunk, (error?: Error | null) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function serializeControlFrame(
  command: UpstreamCommand,
  environment: NodeJS.ProcessEnv,
  shutdownGraceMs: number
): string {
  const normalizedEnvironment = Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  const frame = `${JSON.stringify({
    schemaVersion: controlSchemaVersion,
    executable: command.executable,
    argv: [...command.argv],
    environment: normalizedEnvironment,
    shutdownGraceMs
  } satisfies PosixGuardianControlFrame)}\n`;
  if (Buffer.byteLength(frame, "utf8") > maximumControlFrameBytes) {
    throw new Error("POSIX process guardian control frame exceeds limit");
  }
  return frame;
}

function parseControlFrame(line: string): PosixGuardianControlFrame {
  const value: unknown = JSON.parse(line);
  if (!isRecord(value) || value.schemaVersion !== controlSchemaVersion) {
    throw new Error("invalid control schema");
  }
  if (typeof value.executable !== "string" || value.executable.length === 0) {
    throw new Error("invalid executable");
  }
  if (!Array.isArray(value.argv) || !value.argv.every((item) => typeof item === "string")) {
    throw new Error("invalid argv");
  }
  if (!isRecord(value.environment) || !Object.values(value.environment).every((item) => typeof item === "string")) {
    throw new Error("invalid environment");
  }
  if (!Number.isSafeInteger(value.shutdownGraceMs) || Number(value.shutdownGraceMs) < 0) {
    throw new Error("invalid shutdown grace");
  }
  return {
    schemaVersion: controlSchemaVersion,
    executable: value.executable,
    argv: value.argv as string[],
    environment: value.environment as Record<string, string>,
    shutdownGraceMs: Number(value.shutdownGraceMs)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function waitForChildExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

function writeGuardianDiagnostic(reason: string): void {
  process.stderr.write(`POSIX process guardian ${reason}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runPosixProcessGuardian()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      writeGuardianDiagnostic("failed");
      process.exitCode = 1;
    });
}
