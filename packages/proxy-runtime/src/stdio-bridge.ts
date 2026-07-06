import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { AuditEvent, PolicyDocument } from "@0disoft/mcp-security-proxy-contracts";
import { createProxySession } from "./session.js";

export interface UpstreamCommand {
  readonly executable: string;
  readonly argv: readonly string[];
}

export interface UpstreamProcess {
  readonly stdin: Writable;
  readonly stdout: Readable;
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
}

export interface StdioProxyResult {
  readonly exitCode: number;
}

class AuditFailure extends Error {}

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
    ...(options.approvalHookAvailable !== undefined ? { approvalHookAvailable: options.approvalHookAvailable } : {})
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
    if (result.forwardLine) {
      writeLine(options.clientOutput, result.forwardLine);
    }
  });

  try {
    const upstreamExit = upstream.exit.catch(() => 4);
    const first = await Promise.race([
      clientDone.then(() => "client" as const),
      upstreamDone.then(() => "upstream-output" as const),
      upstreamExit
    ]);

    if (first === "client") {
      upstream.stdin.end();
      const exitCode = await upstreamExit;
      await upstreamDone;
      return { exitCode };
    }

    if (first === "upstream-output") {
      const exitCode = await upstreamExit;
      return { exitCode };
    }

    upstream.kill();
    return { exitCode: first };
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
