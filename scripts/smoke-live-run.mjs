import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = mkdtempSync(join(tmpdir(), "mcp-security-proxy-"));
const auditLog = join(tempDir, "audit.jsonl");

try {
  const child = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      auditLog,
      "--",
      process.execPath,
      "scripts/fixture-mcp-server.mjs"
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "tools", method: "tools/list" })}\n`);
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "denied",
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: {
          path: "workspace/private/secret.txt"
        }
      }
    })}\n`
  );
  child.stdin.end();

  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`expected live run smoke to exit 0, got ${exitCode}: ${Buffer.concat(stderrChunks).toString("utf8")}`);
  }

  const outputLines = Buffer.concat(stdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));

  const toolsResult = outputLines.find((line) => line.id === "tools");
  const deniedResult = outputLines.find((line) => line.id === "denied");
  if (!toolsResult || toolsResult.result.tools.length !== 1 || toolsResult.result.tools[0].name !== "read_file") {
    throw new Error(`unexpected filtered tools response: ${JSON.stringify(toolsResult)}`);
  }
  if (!deniedResult?.error?.data?.decision || deniedResult.error.data.decision.action !== "deny") {
    throw new Error(`unexpected denied call response: ${JSON.stringify(deniedResult)}`);
  }

  const auditLines = readFileSync(auditLog, "utf8")
    .split("\n")
    .filter((line) => line.length > 0);
  if (auditLines.length < 2) {
    throw new Error(`expected audit events, got ${auditLines.length}`);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
