import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { AuditEvent, PolicyDocument } from "@0disoft/mcp-security-proxy-contracts";
import { runStdioProxy, type UpstreamProcess } from "./stdio-bridge.js";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("stdio proxy bridge", () => {
  it("keeps denied client calls off upstream stdin and writes an MCP error to client stdout", async () => {
    const harness = createHarness();
    const run = runHarness(harness);

    harness.clientInput.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/private/secret.txt"
          }
        }
      })}\n`
    );
    harness.clientInput.end();
    harness.upstream.stdout.end();
    harness.upstream.stderr.end();

    const result = await run;
    expect(result.exitCode).toBe(0);
    expect(readLines(harness.upstreamInputCapture)).toEqual([]);

    const output = readLines(harness.clientOutputCapture).map((line) => JSON.parse(line) as any);
    expect(output[0]).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32001,
        data: {
          decision: {
            action: "deny"
          }
        }
      }
    });
    expect(harness.auditEvents[0]).toMatchObject({
      kind: "call-decision",
      decision: { action: "deny" }
    });
  });

  it("forwards allowed client calls and upstream responses line by line", async () => {
    const harness = createHarness();
    const run = runHarness(harness);
    const toolsListRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: "tools",
      method: "tools/list"
    });
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: {
          path: "workspace/public/readme.md"
        }
      }
    });

    harness.clientInput.write(`${toolsListRequest}\n`);
    await nextTick();
    harness.upstream.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "tools",
        result: JSON.parse(readFileSync(resolve(repoRoot, "fixtures/mcp/tools-list-basic.json"), "utf8")) as unknown
      })}\n`
    );
    await nextTick();
    harness.clientInput.write(`${request}\n`);
    harness.upstream.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [] } })}\n`);
    harness.clientInput.end();
    harness.upstream.stdout.end();
    harness.upstream.stderr.end();

    const result = await run;
    expect(result.exitCode).toBe(0);
    expect(readLines(harness.upstreamInputCapture)).toEqual([toolsListRequest, request]);
    expect(readLines(harness.clientOutputCapture).map((line) => JSON.parse(line) as any)).toContainEqual(
      expect.objectContaining({ id: 2, result: { content: [] } })
    );
    expect(harness.auditEvents).toContainEqual(expect.objectContaining({ kind: "discovery-filtered" }));
    expect(harness.auditEvents).toContainEqual(
      expect.objectContaining({
        kind: "call-decision",
        decision: expect.objectContaining({ action: "allow" })
      })
    );
  });

  it("returns denied upstream server request errors to upstream stdin without exposing them to client stdout", async () => {
    const harness = createHarness();
    const run = runHarness(harness);

    harness.upstream.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "server-request",
        method: "sampling/createMessage",
        params: {
          messages: []
        }
      })}\n`
    );
    harness.clientInput.end();
    harness.upstream.stdout.end();
    harness.upstream.stderr.end();

    const result = await run;
    expect(result.exitCode).toBe(0);
    expect(readLines(harness.clientOutputCapture)).toEqual([]);

    const upstreamReplies = readLines(harness.upstreamInputCapture).map((line) => JSON.parse(line) as any);
    expect(upstreamReplies).toContainEqual(
      expect.objectContaining({
        jsonrpc: "2.0",
        id: "server-request",
        error: expect.objectContaining({
          code: -32001,
          data: expect.objectContaining({
            decision: expect.objectContaining({
              action: "deny",
              evidence: [expect.objectContaining({ method: "sampling/createMessage" })]
            })
          })
        })
      })
    );
    expect(harness.auditEvents).toContainEqual(
      expect.objectContaining({
        kind: "method-denied",
        method: "sampling/createMessage",
        decision: expect.objectContaining({ action: "deny" })
      })
    );
  });

  it("fails closed when audit writing fails under fail_closed policy", async () => {
    const harness = createHarness({ failAuditWrites: true });
    const resultPromise = runHarness(harness);

    harness.clientInput.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/list" })}\n`);
    harness.clientInput.end();
    harness.upstream.stdout.end();
    harness.upstream.stderr.end();

    const result = await resultPromise;
    expect(result.exitCode).toBe(5);
    expect(harness.upstream.killed).toBe(true);
  });

  it("continues when audit writing fails under warn_and_continue policy", async () => {
    const harness = createHarness({ failAuditWrites: true });
    const resultPromise = runHarness(harness, { auditOnFailure: "warn_and_continue" });

    harness.clientInput.write(`${JSON.stringify({ jsonrpc: "2.0", id: 4, method: "resources/list" })}\n`);
    harness.clientInput.end();
    harness.upstream.stdout.end();
    harness.upstream.stderr.end();

    const result = await resultPromise;
    expect(result.exitCode).toBe(0);
    expect(harness.upstream.killed).toBe(false);
    expect(readLines(harness.clientOutputCapture).map((line) => JSON.parse(line) as any)).toContainEqual(
      expect.objectContaining({
        id: 4,
        error: expect.objectContaining({
          data: expect.objectContaining({
            decision: expect.objectContaining({
              action: "deny"
            })
          })
        })
      })
    );
    expect(harness.auditEvents).toEqual([]);
  });

  it("records upstream stderr as a redacted summary without raw stderr content", async () => {
    const harness = createHarness();
    const resultPromise = runHarness(harness);

    harness.upstream.stderr.write("RAW_STDERR_MARKER first line\n");
    harness.upstream.stderr.write("RAW_STDERR_MARKER second line\n");
    harness.clientInput.end();
    harness.upstream.stdout.end();
    harness.upstream.stderr.end();

    const result = await resultPromise;
    expect(result.exitCode).toBe(0);
    const auditText = JSON.stringify(harness.auditEvents);
    expect(auditText).not.toContain("RAW_STDERR_MARKER");
    expect(harness.auditEvents).toContainEqual(
      expect.objectContaining({
        kind: "error",
        redaction: {
          applied: true,
          counts: {
            stderr_line: 2
          }
        }
      })
    );
  });

  it("maps non-zero upstream exits to the upstream failure exit code and audits the exit", async () => {
    const harness = createHarness({ upstreamExitCode: 19 });
    const resultPromise = runHarness(harness);

    harness.clientInput.end();
    harness.upstream.stdout.end();
    harness.upstream.stderr.end();

    const result = await resultPromise;
    expect(result.exitCode).toBe(4);
    expect(harness.auditEvents).toContainEqual(
      expect.objectContaining({
        kind: "error",
        decision: {
          schemaVersion: "msp.decision.v1",
          action: "deny",
          evidence: [
            {
              reason: "upstream process exited with code 19"
            }
          ]
        }
      })
    );
  });

  it("kills upstream when client input closes and upstream does not exit within the grace window", async () => {
    const harness = createHarness({ upstreamNeverExits: true });
    const resultPromise = runHarness(harness, { shutdownGraceMs: 1 });

    harness.clientInput.end();
    harness.upstream.stdout.end();
    harness.upstream.stderr.end();

    const result = await resultPromise;
    expect(result.exitCode).toBe(4);
    expect(harness.upstream.killed).toBe(true);
    expect(harness.auditEvents).toContainEqual(
      expect.objectContaining({
        kind: "error",
        decision: expect.objectContaining({
          evidence: [
            {
              reason: "upstream process did not exit after client input closed"
            }
          ]
        })
      })
    );
  });

  it("kills upstream when stdout closes and the process does not exit within the grace window", async () => {
    const harness = createHarness({ upstreamNeverExits: true });
    const resultPromise = runHarness(harness, { shutdownGraceMs: 1 });

    harness.upstream.stdout.end();
    harness.upstream.stderr.end();

    const result = await resultPromise;
    expect(result.exitCode).toBe(4);
    expect(harness.upstream.killed).toBe(true);
    expect(harness.auditEvents).toContainEqual(
      expect.objectContaining({
        kind: "error",
        decision: expect.objectContaining({
          evidence: [
            {
              reason: "upstream process did not exit after stdout closed"
            }
          ]
        })
      })
    );
  });
});

function runHarness(
  harness: ReturnType<typeof createHarness>,
  options: { readonly shutdownGraceMs?: number; readonly auditOnFailure?: PolicyDocument["profiles"][number]["audit"]["onFailure"] } = {}
): Promise<{ readonly exitCode: number }> {
  return runStdioProxy({
    policy: readPolicy(options.auditOnFailure),
    profileId: "local",
    upstreamCommand: {
      executable: "fixture",
      argv: []
    },
    clientInput: harness.clientInput,
    clientOutput: harness.clientOutput,
    spawnUpstream: () => harness.upstream,
    ...(options.shutdownGraceMs !== undefined ? { shutdownGraceMs: options.shutdownGraceMs } : {}),
    writeAuditEvent: (event) => {
      if (harness.failAuditWrites) {
        throw new Error("audit sink failed");
      }
      harness.auditEvents.push(event);
    }
  });
}

function createHarness(
  options: { readonly failAuditWrites?: boolean; readonly upstreamExitCode?: number; readonly upstreamNeverExits?: boolean } = {}
): {
  readonly clientInput: PassThrough;
  readonly clientOutput: PassThrough;
  readonly clientOutputCapture: Buffer[];
  readonly upstream: UpstreamProcess & { readonly stdout: PassThrough; readonly stderr: PassThrough; readonly killed: boolean };
  readonly upstreamInputCapture: Buffer[];
  readonly auditEvents: AuditEvent[];
  readonly failAuditWrites: boolean;
} {
  const clientInput = new PassThrough();
  const clientOutput = new PassThrough();
  const upstreamInput = new PassThrough();
  const upstreamOutput = new PassThrough();
  const upstreamError = new PassThrough();
  const clientOutputCapture: Buffer[] = [];
  const upstreamInputCapture: Buffer[] = [];
  let killed = false;

  clientOutput.on("data", (chunk: Buffer) => clientOutputCapture.push(chunk));
  upstreamInput.on("data", (chunk: Buffer) => upstreamInputCapture.push(chunk));

  return {
    clientInput,
    clientOutput,
    clientOutputCapture,
    upstream: {
      stdin: upstreamInput,
      stdout: upstreamOutput,
      stderr: upstreamError,
      exit: options.upstreamNeverExits
        ? new Promise(() => undefined)
        : new Promise((resolve) => upstreamOutput.once("end", () => resolve(options.upstreamExitCode ?? 0))),
      kill: () => {
        killed = true;
      },
      get killed() {
        return killed;
      }
    },
    upstreamInputCapture,
    auditEvents: [],
    failAuditWrites: options.failAuditWrites ?? false
  };
}

function readPolicy(auditOnFailure?: PolicyDocument["profiles"][number]["audit"]["onFailure"]): PolicyDocument {
  const policy = JSON.parse(readFileSync(resolve(repoRoot, "fixtures/policies/local-dev.json"), "utf8")) as PolicyDocument;
  if (!auditOnFailure) {
    return policy;
  }
  return {
    ...policy,
    profiles: policy.profiles.map((profile) =>
      profile.id === "local"
        ? {
            ...profile,
            audit: {
              ...profile.audit,
              onFailure: auditOnFailure
            }
          }
        : profile
    )
  };
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function readLines(chunks: readonly Buffer[]): readonly string[] {
  return Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}
