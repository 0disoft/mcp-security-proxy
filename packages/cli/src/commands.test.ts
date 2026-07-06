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
    expect(json.tools).toHaveLength(3);
    expect(json.tools[0]).toMatchObject({
      name: "read_file",
      capabilities: ["file-read"],
      policyCovered: true
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
        action: "deny",
        evidence: [{ ruleId: "deny-private-files" }]
      }
    });
  });

  it("keeps live run unavailable during the dry-run milestone", () => {
    const output = invoke(["run", "--json"]);

    expect(output.exitCode).toBe(6);
    expect(output.stdoutJson()).toMatchObject({
      ok: false,
      error: {
        code: 6
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
    ["abc", "--shutdown-grace-ms must be a non-negative integer between 0 and 2147483647"],
    ["-1", "--shutdown-grace-ms must be a non-negative integer between 0 and 2147483647"],
    ["2147483648", "--shutdown-grace-ms must be a non-negative integer between 0 and 2147483647"]
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
      "fixtures/policies/broken.json": "{"
    });

    expect(output.exitCode).toBe(3);
    expect(output.stdoutJson()).toMatchObject({
      ok: false,
      error: {
        code: 3
      }
    });
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
  readonly auditLines: () => readonly string[];
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}> {
  const clientInput = new PassThrough();
  const mcpOutput = new PassThrough();
  const upstreamInput = new PassThrough();
  const upstreamOutput = new PassThrough();
  const mcpChunks: Buffer[] = [];
  const upstreamInputChunks: Buffer[] = [];
  const auditWrites: string[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  let killed = false;

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
    appendTextFile: (_path, text) => {
      auditWrites.push(text);
    },
    spawnUpstream: () => upstream
  };

  return {
    result: runCliAsync(argv, io),
    clientInput,
    mcpOutputLines: () => readLines(mcpChunks),
    mcpOutputJson: () => JSON.parse(readLines(mcpChunks)[0] ?? "{}") as any,
    upstream,
    upstreamInputLines: () => readLines(upstreamInputChunks),
    auditLines: () => auditWrites.flatMap((write) => write.split("\n").filter((line) => line.length > 0)),
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
