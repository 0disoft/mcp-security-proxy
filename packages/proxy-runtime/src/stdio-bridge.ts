import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import type { AuditEvent, PolicyDocument } from "@0disoft/mcp-security-proxy-contracts";
import { createAuditEvent } from "@0disoft/mcp-security-proxy-core";
import { createProxySession, type ApprovalHook } from "./session.js";

export interface UpstreamCommand {
  readonly executable: string;
  readonly argv: readonly string[];
}

export interface UpstreamProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr?: Readable;
  readonly exit: Promise<number>;
  readonly kill: () => void;
}

export interface StdioProxyOptions {
  readonly policy: PolicyDocument;
  readonly profileId: string;
  readonly upstreamCommand: UpstreamCommand;
  readonly clientInput: Readable;
  readonly clientOutput: Writable;
  readonly spawnUpstream: (command: UpstreamCommand) => UpstreamProcess;
  readonly writeAuditEvent: (event: AuditEvent) => void | Promise<void>;
  readonly approvalHookAvailable?: boolean;
  readonly approveToolCall?: ApprovalHook;
  readonly approvalTimeoutMs?: number;
  readonly shutdownGraceMs?: number;
  readonly maxFrameBytes?: number;
  readonly maxJsonDepth?: number;
}

export interface StdioProxyResult {
  readonly exitCode: number;
}

class AuditFailure extends Error {}

const defaultShutdownGraceMs = 1_000;
const defaultMaxFrameBytes = 1_048_576;

export async function runStdioProxy(options: StdioProxyOptions): Promise<StdioProxyResult> {
  const profile = options.policy.profiles.find((item) => item.id === options.profileId);
  if (!profile) {
    return { exitCode: 3 };
  }

  let upstream: UpstreamProcess;
  try {
    upstream = options.spawnUpstream(options.upstreamCommand);
  } catch {
    return { exitCode: 4 };
  }

  const maxFrameBytes = resolvePositiveInteger(options.maxFrameBytes, defaultMaxFrameBytes);
  const session = createProxySession({
    policy: options.policy,
    profileId: options.profileId,
    approvalHookAvailable: Boolean(options.approveToolCall ?? options.approvalHookAvailable),
    ...(options.approvalTimeoutMs !== undefined ? { approvalTimeoutMs: options.approvalTimeoutMs } : {}),
    maxFrameBytes,
    ...(options.maxJsonDepth !== undefined ? { maxJsonDepth: options.maxJsonDepth } : {})
  });

  let fatalExitCode: number | undefined;

  const recordAudit = async (events: readonly AuditEvent[]): Promise<void> => {
    for (const event of events) {
      try {
        await options.writeAuditEvent(event);
      } catch {
        if (profile.audit.onFailure === "fail_closed") {
          throw new AuditFailure("audit write failed");
        }
      }
    }
  };
  const stderrDone = observeUpstreamStderr(upstream.stderr, options.profileId, recordAudit, maxFrameBytes);

  const clientDone = consumeFrames(options.clientInput, maxFrameBytes, async (line) => {
    const result = options.approveToolCall
      ? await session.handleClientLineWithApproval(line, options.approveToolCall)
      : session.handleClientLine(line);
    await recordAudit(result.auditEvents);
    if (result.responseLine) {
      await writeLine(options.clientOutput, result.responseLine);
    }
    if (result.forwardLine) {
      await writeLine(upstream.stdin, result.forwardLine);
    }
  });

  const upstreamDone = consumeFrames(upstream.stdout, maxFrameBytes, async (line) => {
    const result = session.handleServerLine(line);
    await recordAudit(result.auditEvents);
    if (result.responseLine) {
      await writeLineIfOpen(upstream.stdin, result.responseLine);
    }
    if (result.forwardLine) {
      await writeLine(options.clientOutput, result.forwardLine);
    }
  });

  try {
    const upstreamExit = upstream.exit.catch(() => -1);
    const first = await Promise.race([
      clientDone.then(() => "client" as const),
      upstreamDone.then(() => "upstream-output" as const),
      upstreamExit
    ]);

    if (first === "client") {
      upstream.stdin.end();
      const exitCode = await waitForUpstreamExitOrKill(upstream, upstreamExit, options.shutdownGraceMs ?? defaultShutdownGraceMs, -2);
      await upstreamDone;
      await stderrDone;
      return { exitCode: await normalizeUpstreamExit(exitCode, options.profileId, recordAudit) };
    }

    if (first === "upstream-output") {
      const exitCode = await waitForUpstreamExitOrKill(upstream, upstreamExit, options.shutdownGraceMs ?? defaultShutdownGraceMs, -3);
      await stderrDone;
      return { exitCode: await normalizeUpstreamExit(exitCode, options.profileId, recordAudit) };
    }

    await upstreamDone;
    await stderrDone;
    return { exitCode: await normalizeUpstreamExit(first, options.profileId, recordAudit) };
  } catch (error) {
    if (error instanceof AuditFailure) {
      fatalExitCode = 5;
    } else {
      fatalExitCode = 1;
    }
    upstream.kill();
    return { exitCode: fatalExitCode };
  } finally {
    options.clientInput.destroy();
    upstream.stdout.destroy();
  }
}

async function consumeFrames(input: Readable, maxFrameBytes: number, onLine: (line: string) => Promise<void>): Promise<void> {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let bytes = 0;
  let discardingOversizedFrame = false;

  const consumeText = async (text: string): Promise<void> => {
    let start = 0;
    while (start <= text.length) {
      const newline = text.indexOf("\n", start);
      if (newline === -1) {
        await consumeFragment(text.slice(start), false);
        return;
      }
      await consumeFragment(text.slice(start, newline), true);
      start = newline + 1;
    }
  };

  const consumeFragment = async (fragment: string, hasDelimiter: boolean): Promise<void> => {
    if (discardingOversizedFrame) {
      if (hasDelimiter) {
        resetFrame();
      }
      return;
    }

    const nextBytes = bytes + Buffer.byteLength(fragment, "utf8");
    if (nextBytes > maxFrameBytes) {
      await onLine("x".repeat(maxFrameBytes + 1));
      buffer = "";
      bytes = 0;
      discardingOversizedFrame = true;
      if (hasDelimiter) {
        resetFrame();
      }
      return;
    }

    buffer += fragment;
    bytes = nextBytes;
    if (hasDelimiter) {
      const line = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      resetFrame();
      await onLine(line);
    }
  };

  const resetFrame = (): void => {
    buffer = "";
    bytes = 0;
    discardingOversizedFrame = false;
  };

  for await (const chunk of input) {
    await consumeText(typeof chunk === "string" ? chunk : decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  }

  const remaining = decoder.end();
  if (remaining.length > 0) {
    await consumeText(remaining);
  }
  if (!discardingOversizedFrame && buffer.length > 0) {
    await onLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
  }
}

async function writeLine(stream: Writable, line: string): Promise<void> {
  if (stream.destroyed || stream.writableEnded) {
    throw new Error("output stream is closed");
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      stream.off("error", onError);
      stream.off("close", onClose);
    };
    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback();
    };
    const onError = (error: Error): void => settle(() => reject(error));
    const onClose = (): void => settle(() => reject(new Error("output stream closed before write completed")));

    stream.once("error", onError);
    stream.once("close", onClose);
    stream.write(`${line}\n`, (error?: Error | null) => {
      if (error) {
        settle(() => reject(error));
        return;
      }
      settle(resolve);
    });
  });
}

async function writeLineIfOpen(stream: Writable, line: string): Promise<void> {
  if (stream.destroyed || stream.writableEnded) {
    return;
  }
  await writeLine(stream, line);
}

async function waitForUpstreamExitOrKill(
  upstream: UpstreamProcess,
  upstreamExit: Promise<number>,
  shutdownGraceMs: number,
  timeoutExitCode: -2 | -3
): Promise<number> {
  const timeoutExit = new Promise<number>((resolve) => {
    const timer = setTimeout(() => {
      upstream.kill();
      resolve(timeoutExitCode);
    }, Math.max(0, shutdownGraceMs));
    upstreamExit.finally(() => clearTimeout(timer));
  });
  return Promise.race([upstreamExit, timeoutExit]);
}

async function normalizeUpstreamExit(
  exitCode: number,
  profileId: string,
  recordAudit: (events: readonly AuditEvent[]) => Promise<void>
): Promise<number> {
  if (exitCode === 0) {
    return 0;
  }

  await recordAudit([
    createAuditEvent({
      kind: "error",
      profileId,
      decision: {
        schemaVersion: "msp.decision.v1",
        action: "deny",
        evidence: [
          {
            code: "runtime.upstream_exit",
            reason:
              exitCode === -2
                ? "upstream process did not exit after client input closed"
                : exitCode === -3
                  ? "upstream process did not exit after stdout closed"
                  : exitCode === -1
                    ? "upstream process failed before reporting an exit code"
                    : `upstream process exited with code ${exitCode}`
          }
        ]
      },
      redaction: {
        applied: false,
        counts: {}
      }
    })
  ]);
  return 4;
}

async function observeUpstreamStderr(
  stderr: Readable | undefined,
  profileId: string,
  recordAudit: (events: readonly AuditEvent[]) => Promise<void>,
  maxFrameBytes: number
): Promise<void> {
  if (!stderr) {
    return;
  }

  let lineCount = 0;
  await consumeFrames(stderr, maxFrameBytes, async () => {
    lineCount += 1;
  });

  if (lineCount === 0) {
    return;
  }

  await recordAudit([
    createAuditEvent({
      kind: "error",
      profileId,
      decision: {
        schemaVersion: "msp.decision.v1",
        action: "deny",
        evidence: [
          {
            code: "runtime.upstream_stderr",
            reason: `upstream stderr produced ${lineCount} line(s); content redacted`
          }
        ]
      },
      redaction: {
        applied: true,
        counts: {
          stderr_line: lineCount
        }
      }
    })
  ]);
}

function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    return fallback;
  }
  return value;
}
