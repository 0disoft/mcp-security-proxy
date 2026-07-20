import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import {
  type AuditPolicy,
  type AuditEvent,
  type PolicyDocument,
  type PolicyReloadRejectionCode,
  type StdioProxyMetrics,
  type StdioProxyOpsEvent
} from "@0disoft/mcp-security-proxy-contracts";
import { createAuditEvent } from "@0disoft/mcp-security-proxy-core";
import { createProxySession, type ApprovalHook } from "./session.js";
import { AuditCorrelator } from "./audit-correlation.js";

export interface UpstreamCommand {
  readonly executable: string;
  readonly argv: readonly string[];
}

export interface UpstreamProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr?: Readable;
  readonly exit: Promise<number>;
  readonly kill: (force?: boolean) => void | Promise<void>;
}

export interface StdioProxyOptions {
  readonly policy: PolicyDocument;
  readonly profileId: string;
  readonly upstreamCommand: UpstreamCommand;
  readonly clientInput: Readable;
  readonly clientOutput: Writable;
  readonly spawnUpstream: (command: UpstreamCommand) => UpstreamProcess;
  readonly writeAuditEvent: (event: AuditEvent) => void | Promise<void>;
  readonly writeOpsEvent?: (event: StdioProxyOpsEvent) => void | Promise<void>;
  readonly approvalHookAvailable?: boolean;
  readonly approveToolCall?: ApprovalHook;
  readonly approvalTimeoutMs?: number;
  readonly shutdownGraceMs?: number;
  readonly maxFrameBytes?: number;
  readonly maxJsonDepth?: number;
  readonly policyReloadSource?: PolicyReloadSource;
}

export type PolicyReloadUpdate =
  | {
      readonly status: "accepted";
      readonly policy: PolicyDocument;
    }
  | {
      readonly status: "rejected";
      readonly reasonCode: PolicyReloadRejectionCode;
    };

export interface PolicyReloadSource {
  readonly subscribe: (listener: (update: PolicyReloadUpdate) => void | Promise<void>) => () => void;
}

export interface StdioProxyResult {
  readonly exitCode: number;
}

class AuditFailure extends Error {}

const defaultShutdownGraceMs = 1_000;
const defaultMaxFrameBytes = 1_048_576;

function noop(): void {}

type MutableStdioProxyMetrics = {
  -readonly [Key in keyof StdioProxyMetrics]: StdioProxyMetrics[Key];
};

type StreamCompletion =
  | {
      readonly status: "completed";
    }
  | {
      readonly status: "failed";
      readonly error: unknown;
    };

interface UpstreamExitResult {
  readonly exitCode: number;
  readonly forcedStreamClosure: boolean;
}

export async function runStdioProxy(options: StdioProxyOptions): Promise<StdioProxyResult> {
  const startedAt = Date.now();
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
  const auditCorrelator = new AuditCorrelator();
  const session = createProxySession({
    policy: options.policy,
    profileId: options.profileId,
    approvalHookAvailable: Boolean(options.approveToolCall ?? options.approvalHookAvailable),
    ...(options.approvalTimeoutMs !== undefined ? { approvalTimeoutMs: options.approvalTimeoutMs } : {}),
    maxFrameBytes,
    auditCorrelator,
    ...(options.maxJsonDepth !== undefined ? { maxJsonDepth: options.maxJsonDepth } : {})
  });

  let fatalExitCode: number | undefined;
  const metrics: MutableStdioProxyMetrics = {
    clientFrames: 0,
    upstreamFrames: 0,
    clientFramesForwarded: 0,
    upstreamFramesForwarded: 0,
    clientDenials: 0,
    upstreamDenials: 0,
    protocolResponsesWritten: 0,
    auditEventsWritten: 0,
    auditWriteFailures: 0,
    policyReloadsApplied: 0,
    policyReloadsRejected: 0
  };

  const recordAudit = async (events: readonly AuditEvent[]): Promise<void> => {
    for (const event of events) {
      try {
        await options.writeAuditEvent(event);
        metrics.auditEventsWritten += 1;
      } catch {
        metrics.auditWriteFailures += 1;
        if (profile.audit.onFailure === "fail_closed") {
          throw new AuditFailure("audit write failed");
        }
      }
    }
  };
  const recordOps = async (event: StdioProxyOpsEvent): Promise<void> => {
    try {
      await options.writeOpsEvent?.(event);
    } catch {
      // Ops telemetry is diagnostic only. Audit failure policy remains the security gate.
    }
  };
  let sessionOperationQueue = Promise.resolve();
  const runSessionOperation = <Result>(operation: () => Result | Promise<Result>): Promise<Result> => {
    const result = sessionOperationQueue.then(operation);
    sessionOperationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
  let policyOpsQueue = Promise.resolve();
  let unsubscribePolicyReload = noop;
  let policyReloadClosed = false;
  const closePolicyReload = (): void => {
    if (policyReloadClosed) {
      return;
    }
    policyReloadClosed = true;
    unsubscribePolicyReload();
  };
  const finish = async (exitCode: number): Promise<StdioProxyResult> => {
    closePolicyReload();
    await sessionOperationQueue;
    await policyOpsQueue;
    await recordOps(createStopOpsEvent(options.profileId, exitCode, startedAt, metrics));
    return { exitCode };
  };
  await recordOps(createStartOpsEvent(options.profileId, maxFrameBytes, options.maxJsonDepth, metrics));
  const recordPolicyUpdate = async (update: PolicyReloadUpdate): Promise<void> => {
    let rejectionCode: PolicyReloadRejectionCode | undefined;
    let commitPolicyReplacement: (() => number) | undefined;
    if (update.status === "accepted") {
      const nextProfile = update.policy.profiles.find((item) => item.id === options.profileId);
      if (!nextProfile) {
        rejectionCode = "profile_missing";
      } else if (!auditPoliciesEqual(profile.audit, nextProfile.audit)) {
        rejectionCode = "audit_changed";
      } else {
        try {
          commitPolicyReplacement = session.preparePolicyReplacement(update.policy);
        } catch {
          rejectionCode = "runtime_validation_failed";
        }
      }
    }
    await runSessionOperation(() => {
      let event: StdioProxyOpsEvent;
      if (update.status === "rejected") {
        metrics.policyReloadsRejected += 1;
        event = createPolicyReloadRejectedOpsEvent(options.profileId, update.reasonCode, metrics);
      } else if (rejectionCode) {
        metrics.policyReloadsRejected += 1;
        event = createPolicyReloadRejectedOpsEvent(options.profileId, rejectionCode, metrics);
      } else {
        try {
          if (!commitPolicyReplacement) {
            throw new TypeError("validated policy replacement was not prepared");
          }
          const revision = commitPolicyReplacement();
          metrics.policyReloadsApplied += 1;
          event = createPolicyReloadAppliedOpsEvent(options.profileId, revision, metrics);
        } catch {
          metrics.policyReloadsRejected += 1;
          event = createPolicyReloadRejectedOpsEvent(options.profileId, "runtime_validation_failed", metrics);
        }
      }
      policyOpsQueue = policyOpsQueue.then(() => recordOps(event));
    });
  };
  try {
    unsubscribePolicyReload = options.policyReloadSource?.subscribe(recordPolicyUpdate) ?? unsubscribePolicyReload;
  } catch {
    await requestUpstreamTermination(upstream, true);
    return await finish(1);
  }
  const stderrDone = captureStreamCompletion(
    observeUpstreamStderr(upstream.stderr, options.profileId, recordAudit, maxFrameBytes, auditCorrelator)
  );

  const clientDone = consumeFrames(options.clientInput, maxFrameBytes, async (line) => {
    await runSessionOperation(async () => {
      metrics.clientFrames += 1;
      const result = options.approveToolCall
        ? await session.handleClientLineWithApproval(line, options.approveToolCall)
        : session.handleClientLine(line);
      await recordAudit(result.auditEvents);
      if (result.responseLine) {
        metrics.protocolResponsesWritten += 1;
        if (!result.forwardLine) {
          metrics.clientDenials += 1;
        }
        await writeLine(options.clientOutput, result.responseLine);
      }
      if (result.forwardLine) {
        metrics.clientFramesForwarded += 1;
        await writeLine(upstream.stdin, result.forwardLine);
      }
    });
  });

  const upstreamDone = captureStreamCompletion(
    consumeFrames(upstream.stdout, maxFrameBytes, async (line) => {
      await runSessionOperation(async () => {
        metrics.upstreamFrames += 1;
        const result = session.handleServerLine(line);
        await recordAudit(result.auditEvents);
        if (result.responseLine) {
          metrics.protocolResponsesWritten += 1;
          if (!result.forwardLine) {
            metrics.upstreamDenials += 1;
          }
          await writeLineIfOpen(upstream.stdin, result.responseLine);
        }
        if (result.forwardLine) {
          metrics.upstreamFramesForwarded += 1;
          await writeLine(options.clientOutput, result.forwardLine);
        }
      });
    })
  );

  try {
    const upstreamExit = upstream.exit.catch(() => -1);
    const first = await Promise.race([
      clientDone.then(() => "client" as const),
      upstreamDone.then((completion) => {
        if (completion.status === "failed") {
          throw completion.error;
        }
        return "upstream-output" as const;
      }),
      upstreamExit
    ]);

    if (first === "client") {
      upstream.stdin.end();
      const shutdown = await waitForUpstreamExitOrKill(
        upstream,
        upstreamExit,
        options.shutdownGraceMs ?? defaultShutdownGraceMs,
        -2
      );
      await requireStreamCompletion(upstreamDone, upstream.stdout, shutdown.forcedStreamClosure);
      await requireStreamCompletion(stderrDone, upstream.stderr, shutdown.forcedStreamClosure);
      return await finish(
        await normalizeUpstreamExit(shutdown.exitCode, options.profileId, recordAudit, auditCorrelator)
      );
    }

    if (first === "upstream-output") {
      const shutdown = await waitForUpstreamExitOrKill(
        upstream,
        upstreamExit,
        options.shutdownGraceMs ?? defaultShutdownGraceMs,
        -3
      );
      await requireStreamCompletion(stderrDone, upstream.stderr, shutdown.forcedStreamClosure);
      return await finish(
        await normalizeUpstreamExit(shutdown.exitCode, options.profileId, recordAudit, auditCorrelator)
      );
    }

    await requireStreamCompletion(upstreamDone, upstream.stdout, false);
    await requireStreamCompletion(stderrDone, upstream.stderr, false);
    return await finish(await normalizeUpstreamExit(first, options.profileId, recordAudit, auditCorrelator));
  } catch (error) {
    if (error instanceof AuditFailure) {
      fatalExitCode = 5;
    } else {
      fatalExitCode = 1;
    }
    await requestUpstreamTermination(upstream, true);
    return await finish(fatalExitCode);
  } finally {
    closePolicyReload();
    await sessionOperationQueue;
    await policyOpsQueue;
    options.clientInput.destroy();
    upstream.stdout.destroy();
  }
}

function captureStreamCompletion(operation: Promise<void>): Promise<StreamCompletion> {
  return operation.then(
    () => ({ status: "completed" }),
    (error: unknown) => ({ status: "failed", error })
  );
}

async function requireStreamCompletion(
  completionPromise: Promise<StreamCompletion>,
  stream: Readable | undefined,
  allowForcedPrematureClose: boolean
): Promise<void> {
  const completion = await completionPromise;
  if (completion.status === "completed") {
    return;
  }
  if (allowForcedPrematureClose && stream?.destroyed && isPrematureCloseError(completion.error)) {
    return;
  }
  throw completion.error;
}

function isPrematureCloseError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { readonly code?: string }).code === "ERR_STREAM_PREMATURE_CLOSE"
  );
}

export function formatStdioOpsEventJsonLine(event: StdioProxyOpsEvent): string {
  return `${JSON.stringify(event)}\n`;
}

function createStartOpsEvent(
  profileId: string,
  maxFrameBytes: number,
  maxJsonDepth: number | undefined,
  metrics: StdioProxyMetrics
): StdioProxyOpsEvent {
  return {
    schemaVersion: "msp.ops-event.v1",
    timestamp: new Date().toISOString(),
    kind: "lifecycle",
    event: "proxy.start",
    profileId,
    maxFrameBytes,
    ...(maxJsonDepth !== undefined ? { maxJsonDepth } : {}),
    metrics: snapshotMetrics(metrics)
  };
}

function createStopOpsEvent(
  profileId: string,
  exitCode: number,
  startedAt: number,
  metrics: StdioProxyMetrics
): StdioProxyOpsEvent {
  return {
    schemaVersion: "msp.ops-event.v1",
    timestamp: new Date().toISOString(),
    kind: "lifecycle",
    event: "proxy.stop",
    profileId,
    exitCode,
    elapsedMs: Math.max(0, Date.now() - startedAt),
    metrics: snapshotMetrics(metrics)
  };
}

function snapshotMetrics(metrics: StdioProxyMetrics): StdioProxyMetrics {
  return {
    clientFrames: metrics.clientFrames,
    upstreamFrames: metrics.upstreamFrames,
    clientFramesForwarded: metrics.clientFramesForwarded,
    upstreamFramesForwarded: metrics.upstreamFramesForwarded,
    clientDenials: metrics.clientDenials,
    upstreamDenials: metrics.upstreamDenials,
    protocolResponsesWritten: metrics.protocolResponsesWritten,
    auditEventsWritten: metrics.auditEventsWritten,
    auditWriteFailures: metrics.auditWriteFailures,
    policyReloadsApplied: metrics.policyReloadsApplied,
    policyReloadsRejected: metrics.policyReloadsRejected
  };
}

function createPolicyReloadAppliedOpsEvent(
  profileId: string,
  revision: number,
  metrics: StdioProxyMetrics
): StdioProxyOpsEvent {
  return {
    schemaVersion: "msp.ops-event.v1",
    timestamp: new Date().toISOString(),
    kind: "policy",
    event: "policy.reload_applied",
    profileId,
    revision,
    metrics: snapshotMetrics(metrics)
  };
}

function createPolicyReloadRejectedOpsEvent(
  profileId: string,
  reasonCode: PolicyReloadRejectionCode,
  metrics: StdioProxyMetrics
): StdioProxyOpsEvent {
  return {
    schemaVersion: "msp.ops-event.v1",
    timestamp: new Date().toISOString(),
    kind: "policy",
    event: "policy.reload_rejected",
    profileId,
    reasonCode,
    metrics: snapshotMetrics(metrics)
  };
}

function auditPoliciesEqual(left: AuditPolicy, right: AuditPolicy): boolean {
  return (
    left.destination === right.destination &&
    left.path === right.path &&
    left.onFailure === right.onFailure &&
    left.includeRawArguments === right.includeRawArguments &&
    left.includeFullPaths === right.includeFullPaths
  );
}

async function consumeFrames(
  input: Readable,
  maxFrameBytes: number,
  onLine: (line: string) => Promise<void>
): Promise<void> {
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
    await consumeText(
      typeof chunk === "string" ? chunk : decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
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
): Promise<UpstreamExitResult> {
  const timeoutExit = new Promise<UpstreamExitResult>((resolve) => {
    const timer = setTimeout(
      () => {
        void requestUpstreamTermination(upstream, false);
        const forceTimer = setTimeout(async () => {
          await requestUpstreamTermination(upstream, true);
          upstream.stdin.destroy();
          upstream.stdout.destroy();
          upstream.stderr?.destroy();
          resolve({ exitCode: timeoutExitCode, forcedStreamClosure: true });
        }, 250);
        upstreamExit.finally(() => {
          clearTimeout(forceTimer);
          resolve({ exitCode: timeoutExitCode, forcedStreamClosure: false });
        });
      },
      Math.max(0, shutdownGraceMs)
    );
    upstreamExit.finally(() => clearTimeout(timer));
  });
  return Promise.race([upstreamExit.then((exitCode) => ({ exitCode, forcedStreamClosure: false })), timeoutExit]);
}

async function requestUpstreamTermination(upstream: UpstreamProcess, force: boolean): Promise<void> {
  const termination = Promise.resolve()
    .then(() => upstream.kill(force))
    .catch(() => undefined);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      termination,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 1_000);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function normalizeUpstreamExit(
  exitCode: number,
  profileId: string,
  recordAudit: (events: readonly AuditEvent[]) => Promise<void>,
  auditCorrelator: AuditCorrelator
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
      },
      correlation: auditCorrelator.createCorrelation()
    })
  ]);
  return 4;
}

async function observeUpstreamStderr(
  stderr: Readable | undefined,
  profileId: string,
  recordAudit: (events: readonly AuditEvent[]) => Promise<void>,
  maxFrameBytes: number,
  auditCorrelator: AuditCorrelator
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
      },
      correlation: auditCorrelator.createCorrelation()
    })
  ]);
}

function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    return fallback;
  }
  return value;
}
