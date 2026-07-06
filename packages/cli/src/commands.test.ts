import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runCli, type CliIo } from "./commands.js";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("dry-run CLI commands", () => {
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
