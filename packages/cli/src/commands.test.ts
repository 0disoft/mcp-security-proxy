import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import type { UpstreamProcess } from "@0disoft/mcp-security-proxy-runtime";
import { runCli, runCliAsync, type CliIo, type CliRunIo } from "./commands.js";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("dry-run CLI commands", () => {
  it("prints top-level help for global help requests", () => {
    const output = invoke(["--help"]);

    expect(output.exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("Usage: mcp-security-proxy <command> [options]");
    expect(output.stdout.join("\n")).toContain("check-policy");
    expect(output.stdout.join("\n")).toContain("eval-call");
    expect(output.stderr).toEqual([]);
  });

  it("prints command-specific help without running the command", () => {
    const output = invoke(["run", "--help"]);

    expect(output.exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("Usage: mcp-security-proxy run");
    expect(output.stdout.join("\n")).toContain("--audit-log <path>");
    expect(output.stdout.join("\n")).toContain("--shutdown-grace-ms <0..2147483647>");
    expect(output.stdout.join("\n")).toContain("--max-frame-bytes <1..16777216>");
    expect(output.stdout.join("\n")).toContain("--max-json-depth <1..256>");
    expect(output.stdout.join("\n")).not.toContain("--approval-hook");
    expect(output.stdout.join("\n")).not.toContain("not implemented");
    expect(output.stderr).toEqual([]);
  });

  it("prints command-specific help through the help command alias", () => {
    const output = invoke(["help", "eval-call"]);

    expect(output.exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("Usage: mcp-security-proxy eval-call");
    expect(output.stdout.join("\n")).toContain("--approval-hook");
    expect(output.stderr).toEqual([]);
  });

  it("validates policy files", () => {
    const output = invoke(["check-policy", "--policy", "fixtures/policies/local-dev.json", "--json"]);

    expect(output.exitCode).toBe(0);
    expect(output.stdoutJson()).toMatchObject({
      ok: true,
      command: "check-policy",
      policy: {
        profiles: [{ id: "local", rules: 5 }]
      }
    });
  });

  it("rejects unknown command flags instead of silently using defaults", () => {
    const output = invoke([
      "check-policy",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--max-fram-bytes",
      "1024"
    ]);

    expect(output.exitCode).toBe(2);
    expect(output.stderr).toEqual(["unknown flag for check-policy: --max-fram-bytes"]);
  });

  it("classifies captured tool lists without forwarding calls", () => {
    const output = invoke([
      "inspect-tools",
      "--input",
      "fixtures/mcp/tools-list-basic.json",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--json"
    ]);

    expect(output.exitCode).toBe(0);
    const json = output.stdoutJson();
    expect(json).toMatchObject({
      ok: true,
      command: "inspect-tools"
    });
    expect(json.tools).toHaveLength(4);
    expect(json.tools[0]).toMatchObject({
      name: "read_file",
      capabilities: ["file-read"],
      policyCovered: true
    });
    expect(json.tools[2]).toMatchObject({
      name: "read_secret",
      capabilities: ["secret"],
      policyCovered: false
    });
  });

  it("evaluates captured tool calls without treating deny as CLI failure", () => {
    const output = invoke([
      "eval-call",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--input",
      "fixtures/mcp/call-file-read-denied.json",
      "--json"
    ]);

    expect(output.exitCode).toBe(0);
    expect(output.stdoutJson()).toMatchObject({
      ok: true,
      command: "eval-call",
      profile: "local",
      decision: {
        schemaVersion: "msp.decision.v1",
        action: "deny",
        evidence: [{ ruleId: "deny-private-files" }]
      }
    });
  });

  it("keeps live run on the async CLI path only", () => {
    const output = invoke(["run", "--json"]);

    expect(output.exitCode).toBe(2);
    expect(output.stdoutJson()).toMatchObject({
      ok: false,
      error: {
        code: 2,
        message: "run requires async CLI IO; use runCliAsync for live proxy execution"
      }
    });
  });

  it("runs the async stdio proxy path without writing audit records to stdout", async () => {
    const output = await invokeAsync([
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      "audit.jsonl",
      "--",
      "fixture-server"
    ]);

    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/list"
    });
    output.clientInput.write(`${request}\n`);
    output.clientInput.end();
    output.upstream.stdout.end();

    const result = await output.result;
    expect(result.exitCode).toBe(0);
    expect(output.stdout).toEqual([]);
    expect(output.upstreamInputLines()).toEqual([]);
    expect(output.mcpOutputJson()).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: {
        data: {
          decision: {
            action: "deny"
          }
        }
      }
    });
    expect(output.auditLines()).toHaveLength(1);
    expect(output.auditWrites()).toHaveLength(1);
    expect(output.auditWrites()[0]?.endsWith("\n")).toBe(true);
    expect(output.auditWrites()[0]?.slice(0, -1)).not.toContain("\n");
  });

  it("writes optional ops metrics to a separate JSONL file", async () => {
    const output = await invokeAsync([
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      "audit.jsonl",
      "--ops-log",
      "ops.jsonl",
      "--",
      "fixture-server"
    ]);

    output.clientInput.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "ops-cli-denied",
        method: "resources/list"
      })}\n`
    );
    output.clientInput.end();
    output.upstream.stdout.end();

    const result = await output.result;
    expect(result.exitCode).toBe(0);
    expect(output.stdout).toEqual([]);
    expect(output.opsLines()).toHaveLength(2);
    expect(output.opsLines().map((line) => JSON.parse(line) as any)).toEqual([
      expect.objectContaining({
        schemaVersion: "msp.ops-event.v1",
        event: "proxy.start",
        profileId: "local"
      }),
      expect.objectContaining({
        schemaVersion: "msp.ops-event.v1",
        event: "proxy.stop",
        profileId: "local",
        exitCode: 0,
        metrics: expect.objectContaining({
          clientFrames: 1,
          clientDenials: 1,
          protocolResponsesWritten: 1
        })
      })
    ]);
    expect(output.auditLines()).toHaveLength(1);
  });

  it("redacts upstream JSON-RPC error fields on the async stdio proxy path", async () => {
    const output = await invokeAsync([
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      "audit.jsonl",
      "--",
      "fixture-server"
    ]);
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: "redacted-error",
      method: "ping"
    });

    output.clientInput.write(`${request}\n`);
    await nextTick();
    output.upstream.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "redacted-error",
        error: {
          code: -32000,
          message: "failed at workspace/hidden/secret.txt",
          data: {
            marker: "RAW_CLI_ERROR_DATA_MARKER"
          }
        }
      })}\n`
    );
    output.clientInput.end();
    output.upstream.stdout.end();

    const result = await output.result;
    expect(result.exitCode).toBe(0);
    expect(output.stdout).toEqual([]);
    expect(output.upstreamInputLines()).toEqual([request]);
    expect(output.mcpOutputJson()).toMatchObject({
      jsonrpc: "2.0",
      id: "redacted-error",
      error: {
        code: -32000,
        message: "upstream error message redacted"
      }
    });
    expect(output.mcpOutputLines().join("\n")).not.toContain("workspace/hidden/secret.txt");
    expect(output.mcpOutputLines().join("\n")).not.toContain("RAW_CLI_ERROR_DATA_MARKER");
    expect(output.auditLines().join("\n")).not.toContain("workspace/hidden/secret.txt");
    expect(output.auditLines().join("\n")).not.toContain("RAW_CLI_ERROR_DATA_MARKER");
    expect(output.auditLines().map((line) => JSON.parse(line) as any)).toContainEqual(
      expect.objectContaining({
        kind: "error",
        redaction: {
          applied: true,
          counts: {
            jsonrpc_error_data: 1,
            jsonrpc_error_message: 1
          }
        }
      })
    );
  });

  it("applies configured live frame limits before forwarding client input", async () => {
    const output = await invokeAsync([
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      "audit.jsonl",
      "--max-frame-bytes",
      "32",
      "--",
      "fixture-server"
    ]);

    output.clientInput.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: "too-large-for-cli",
        method: "ping"
      })}\n`
    );
    output.clientInput.end();
    output.upstream.stdout.end();

    const result = await output.result;
    expect(result.exitCode).toBe(0);
    expect(output.stdout).toEqual([]);
    expect(output.upstreamInputLines()).toEqual([]);
    expect(output.mcpOutputJson()).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        data: {
          decision: {
            evidence: [{ code: "jsonrpc.frame_too_large" }]
          }
        }
      }
    });
    expect(output.auditLines()).toHaveLength(1);
  });

  it("passes a configured shutdown grace window to the live run path", async () => {
    const output = await invokeAsync(
      [
        "run",
        "--policy",
        "fixtures/policies/local-dev.json",
        "--profile",
        "local",
        "--audit-log",
        "audit.jsonl",
        "--shutdown-grace-ms",
        "0",
        "--",
        "fixture-server"
      ],
      { upstreamNeverExits: true }
    );

    output.clientInput.end();

    const result = await output.result;
    expect(result.exitCode).toBe(4);
    expect(output.stdout).toEqual([]);
    expect(output.upstream.killed).toBe(true);
    expect(output.mcpOutputLines()).toEqual([]);
    expect(output.auditLines().join("\n")).toContain("upstream process did not exit after client input closed");
  });

  it("reports run startup usage errors on stderr because stdout is reserved for MCP", async () => {
    const output = await invokeAsync(["run", "--json"]);

    const result = await output.result;
    expect(result.exitCode).toBe(2);
    expect(output.stdout).toEqual([]);
    expect(output.mcpOutputLines()).toEqual([]);
    expect(output.stderr).toEqual(["run does not support --json because stdout is reserved for MCP messages"]);
  });

  it("rejects approval-hook on live run because approval UX belongs to embedding hosts", async () => {
    const output = await invokeAsync([
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      "audit.jsonl",
      "--approval-hook",
      "--",
      "fixture-server"
    ]);

    const result = await output.result;
    expect(result.exitCode).toBe(2);
    expect(output.stdout).toEqual([]);
    expect(output.mcpOutputLines()).toEqual([]);
    expect(output.stderr).toEqual(["run does not support --approval-hook; approval hooks must be provided by an embedding host"]);
    expect(output.spawned).toBe(false);
  });

  it("requires an explicit separator before the upstream command", async () => {
    const output = await invokeAsync([
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      "audit.jsonl",
      "fixture-server"
    ]);

    const result = await output.result;
    expect(result.exitCode).toBe(2);
    expect(output.stdout).toEqual([]);
    expect(output.mcpOutputLines()).toEqual([]);
    expect(output.stderr).toEqual(["run requires -- before the upstream command"]);
    expect(output.spawned).toBe(false);
  });

  it("reports an empty upstream command after the separator as a usage error", async () => {
    const output = await invokeAsync([
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      "audit.jsonl",
      "--"
    ]);

    const result = await output.result;
    expect(result.exitCode).toBe(2);
    expect(output.stdout).toEqual([]);
    expect(output.mcpOutputLines()).toEqual([]);
    expect(output.stderr).toEqual(["missing upstream command after --"]);
    expect(output.spawned).toBe(false);
  });

  it("prints async run help before the live proxy owns MCP stdout", async () => {
    const output = await invokeAsync(["run", "--help"]);

    const result = await output.result;
    expect(result.exitCode).toBe(0);
    expect(output.stdout.join("\n")).toContain("Usage: mcp-security-proxy run");
    expect(output.stdout.join("\n")).toContain("Stdout is reserved for MCP protocol messages after the live proxy starts.");
    expect(output.mcpOutputLines()).toEqual([]);
    expect(output.stderr).toEqual([]);
  });

  it.each([
    ["abc", "--shutdown-grace-ms must be an integer between 0 and 2147483647"],
    ["-1", "--shutdown-grace-ms must be an integer between 0 and 2147483647"],
    ["2147483648", "--shutdown-grace-ms must be an integer between 0 and 2147483647"]
  ])("rejects invalid shutdown grace values: %s", async (value, message) => {
    const output = await invokeAsync([
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      "audit.jsonl",
      "--shutdown-grace-ms",
      value,
      "--",
      "fixture-server"
    ]);

    const result = await output.result;
    expect(result.exitCode).toBe(2);
    expect(output.mcpOutputLines()).toEqual([]);
    expect(output.stderr).toEqual([message]);
  });

  it.each([
    ["--max-frame-bytes", "0", "--max-frame-bytes must be an integer between 1 and 16777216"],
    ["--max-frame-bytes", "16777217", "--max-frame-bytes must be an integer between 1 and 16777216"],
    ["--max-json-depth", "0", "--max-json-depth must be an integer between 1 and 256"],
    ["--max-json-depth", "257", "--max-json-depth must be an integer between 1 and 256"]
  ])("rejects invalid live frame guard values: %s %s", async (flag, value, message) => {
    const output = await invokeAsync([
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      "audit.jsonl",
      flag,
      value,
      "--",
      "fixture-server"
    ]);

    const result = await output.result;
    expect(result.exitCode).toBe(2);
    expect(output.mcpOutputLines()).toEqual([]);
    expect(output.stderr).toEqual([message]);
    expect(output.spawned).toBe(false);
  });

  it("rejects a missing shutdown grace value", async () => {
    const output = await invokeAsync([
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      "audit.jsonl",
      "--shutdown-grace-ms",
      "--",
      "fixture-server"
    ]);

    const result = await output.result;
    expect(result.exitCode).toBe(2);
    expect(output.mcpOutputLines()).toEqual([]);
    expect(output.stderr).toEqual(["missing required --shutdown-grace-ms value"]);
  });

  it("reports missing required flags as usage errors", () => {
    const output = invoke(["eval-call", "--json"]);

    expect(output.exitCode).toBe(2);
    expect(output.stdoutJson()).toMatchObject({
      ok: false,
      error: {
        code: 2,
        message: "missing required --policy"
      }
    });
  });

  it("reports malformed policy files as policy errors", () => {
    const output = invoke(["check-policy", "--policy", "fixtures/policies/broken.json", "--json"], {
      "fixtures/policies/broken.json": '{"schemaVersion":"RAW_POLICY_SECRET_MARKER"'
    });

    expect(output.exitCode).toBe(3);
    expect(output.stdoutJson()).toMatchObject({
      ok: false,
      command: "check-policy",
      errors: ["policy JSON is invalid"]
    });
    expect(output.stdout.join("\n")).not.toContain("RAW_POLICY_SECRET_MARKER");
  });
});

function invoke(argv: readonly string[], virtualFiles: Readonly<Record<string, string>> = {}): {
  readonly exitCode: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
  readonly stdoutJson: () => any;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    readTextFile: (path) => virtualFiles[path] ?? readFileSync(resolve(repoRoot, path), "utf8"),
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line)
  };
  const result = runCli(argv, io);

  return {
    exitCode: result.exitCode,
    stdout,
    stderr,
    stdoutJson: () => JSON.parse(stdout[0] ?? "{}") as any
  };
}

async function invokeAsync(
  argv: readonly string[],
  options: { readonly upstreamNeverExits?: boolean } = {}
): Promise<{
  readonly result: Promise<{ readonly exitCode: number }>;
  readonly clientInput: PassThrough;
  readonly mcpOutputLines: () => readonly string[];
  readonly mcpOutputJson: () => any;
  readonly upstream: UpstreamProcess & { readonly stdout: PassThrough; readonly killed: boolean };
  readonly upstreamInputLines: () => readonly string[];
  readonly auditWrites: () => readonly string[];
  readonly auditLines: () => readonly string[];
  readonly opsLines: () => readonly string[];
  readonly spawned: boolean;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}> {
  const clientInput = new PassThrough();
  const mcpOutput = new PassThrough();
  const upstreamInput = new PassThrough();
  const upstreamOutput = new PassThrough();
  const mcpChunks: Buffer[] = [];
  const upstreamInputChunks: Buffer[] = [];
  const writesByPath = new Map<string, string[]>();
  const stdout: string[] = [];
  const stderr: string[] = [];
  let killed = false;
  let spawned = false;

  mcpOutput.on("data", (chunk: Buffer) => mcpChunks.push(chunk));
  upstreamInput.on("data", (chunk: Buffer) => upstreamInputChunks.push(chunk));

  const upstream: UpstreamProcess & { readonly stdout: PassThrough; readonly killed: boolean } = {
    stdin: upstreamInput,
    stdout: upstreamOutput,
    exit: options.upstreamNeverExits
      ? new Promise(() => undefined)
      : new Promise((resolve) => upstreamOutput.once("end", () => resolve(0))),
    kill: () => {
      killed = true;
      upstreamOutput.end();
    },
    get killed() {
      return killed;
    }
  };

  const io: CliRunIo = {
    readTextFile: (path) => readFileSync(resolve(repoRoot, path), "utf8"),
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    clientInput,
    mcpOutput,
    appendTextFile: (path, text) => {
      const writes = writesByPath.get(path) ?? [];
      writes.push(text);
      writesByPath.set(path, writes);
    },
    spawnUpstream: () => {
      spawned = true;
      return upstream;
    }
  };

  return {
    result: runCliAsync(argv, io),
    clientInput,
    mcpOutputLines: () => readLines(mcpChunks),
    mcpOutputJson: () => JSON.parse(readLines(mcpChunks)[0] ?? "{}") as any,
    upstream,
    upstreamInputLines: () => readLines(upstreamInputChunks),
    auditWrites: () => writesByPath.get("audit.jsonl") ?? [],
    auditLines: () => readTextLines(writesByPath.get("audit.jsonl") ?? []),
    opsLines: () => readTextLines(writesByPath.get("ops.jsonl") ?? []),
    get spawned() {
      return spawned;
    },
    stdout,
    stderr
  };
}

function readLines(chunks: readonly Buffer[]): readonly string[] {
  return Buffer.concat(chunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0);
}

function readTextLines(chunks: readonly string[]): readonly string[] {
  return chunks.flatMap((write) => write.split("\n").filter((line) => line.length > 0));
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
