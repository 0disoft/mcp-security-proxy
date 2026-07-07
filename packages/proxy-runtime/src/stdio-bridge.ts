import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { AuditEvent, PolicyDocument } from "@0disoft/mcp-security-proxy-contracts";
import { createAuditEvent } from "@0disoft/mcp-security-proxy-core";
import { createProxySession } from "./session.js";

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
  readonly shutdownGraceMs?: number;
  readonly maxFrameBytes?: number;
  readonly maxJsonDepth?: number;
}

export interface StdioProxyResult {
  readonly exitCode: number;
}

class AuditFailure extends Error {}

const defaultShutdownGraceMs = 1_000;

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

  const session = createProxySession({
    policy: options.policy,
    profileId: options.profileId,
    ...(options.approvalHookAvailable !== undefined ? { approvalHookAvailable: options.approvalHookAvailable } : {}),
    ...(options.maxFrameBytes !== undefined ? { maxFrameBytes: options.maxFrameBytes } : {}),
    ...(options.maxJsonDepth !== undefined ? { maxJsonDepth: options.maxJsonDepth } : {})
  });

  const clientLines = createInterface({ input: options.clientInput, crlfDelay: Number.POSITIVE_INFINITY });
  const upstreamLines = createInterface({ input: upstream.stdout, crlfDelay: Number.POSITIVE_INFINITY });
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
  const stderrDone = observeUpstreamStderr(upstream.stderr, options.profileId, recordAudit);

  const clientDone = consumeLines(clientLines, async (line) => {
    const result = session.handleClientLine(line);
    await recordAudit(result.auditEvents);
    if (result.responseLine) {
      writeLine(options.clientOutput, result.responseLine);
    }
    if (result.forwardLine) {
      writeLine(upstream.stdin, result.forwardLine);
    }
  });

  const upstreamDone = consumeLines(upstreamLines, async (line) => {
    const result = session.handleServerLine(line);
    await recordAudit(result.auditEvents);
    if (result.responseLine) {
      writeLine(upstream.stdin, result.responseLine);
    }
    if (result.forwardLine) {
      writeLine(options.clientOutput, result.forwardLine);
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
    clientLines.close();
    upstreamLines.close();
  }
}

async function consumeLines(lines: ReturnType<typeof createInterface>, onLine: (line: string) => Promise<void>): Promise<void> {
  for await (const line of lines) {
    await onLine(line);
  }
}

function writeLine(stream: Writable, line: string): void {
  stream.write(`${line}\n`);
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
  recordAudit: (events: readonly AuditEvent[]) => Promise<void>
): Promise<void> {
  if (!stderr) {
    return;
  }

  const stderrLines = createInterface({ input: stderr, crlfDelay: Number.POSITIVE_INFINITY });
  let lineCount = 0;
  for await (const _line of stderrLines) {
    lineCount += 1;
  }

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
