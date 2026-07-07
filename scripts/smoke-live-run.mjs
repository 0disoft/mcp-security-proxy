import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = mkdtempSync(join(tmpdir(), "mcp-security-proxy-"));
const auditLog = join(tempDir, "audit.jsonl");
const upstreamErrorAuditLog = join(tempDir, "upstream-error-audit.jsonl");
const pingAuditLog = join(tempDir, "ping-audit.jsonl");
const deniedPingAuditLog = join(tempDir, "denied-ping-audit.jsonl");
const failedAuditLog = join(tempDir, "failed-audit.jsonl");
const secretAuditLog = join(tempDir, "secret-audit.jsonl");

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
  const auditText = auditLines.join("\n");
  if (auditText.includes("RAW_STDERR_MARKER")) {
    throw new Error("raw upstream stderr leaked into audit log");
  }
  if (!auditText.includes('"stderr_line":1')) {
    throw new Error(`expected redacted stderr summary audit event, got ${auditText}`);
  }

  const upstreamErrorChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      upstreamErrorAuditLog,
      "--",
      process.execPath,
      "scripts/fixture-mcp-server.mjs",
      "--upstream-error-on-tool-call"
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  const upstreamErrorStdoutChunks = [];
  const upstreamErrorStderrChunks = [];
  const upstreamErrorOutputLines = [];
  upstreamErrorChild.stdout.on("data", (chunk) => upstreamErrorStdoutChunks.push(chunk));
  upstreamErrorChild.stderr.on("data", (chunk) => upstreamErrorStderrChunks.push(chunk));
  const waitForUpstreamErrorTools = waitForJsonLine(upstreamErrorChild.stdout, (line) => {
    upstreamErrorOutputLines.push(line);
    return line.id === "upstream-error-tools";
  });
  upstreamErrorChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "upstream-error-tools", method: "tools/list" })}\n`);
  await waitForUpstreamErrorTools;
  upstreamErrorChild.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "upstream-error-call",
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: {
          path: "workspace/public/readme.md"
        }
      }
    })}\n`
  );
  upstreamErrorChild.stdin.end();
  const upstreamErrorExitCode = await new Promise((resolve, reject) => {
    upstreamErrorChild.once("error", reject);
    upstreamErrorChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (upstreamErrorExitCode !== 0) {
    throw new Error(
      `expected upstream error live run smoke to exit 0, got ${upstreamErrorExitCode}: ${Buffer.concat(upstreamErrorStderrChunks).toString("utf8")}`
    );
  }
  for (const line of Buffer.concat(upstreamErrorStdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))) {
    if (!upstreamErrorOutputLines.some((item) => item.id === line.id)) {
      upstreamErrorOutputLines.push(line);
    }
  }
  const upstreamErrorToolsResult = upstreamErrorOutputLines.find((line) => line.id === "upstream-error-tools");
  const upstreamErrorCallResult = upstreamErrorOutputLines.find((line) => line.id === "upstream-error-call");
  if (!upstreamErrorToolsResult || upstreamErrorToolsResult.result.tools.length !== 1 || upstreamErrorToolsResult.result.tools[0].name !== "read_file") {
    throw new Error(`unexpected upstream error filtered tools response: ${JSON.stringify(upstreamErrorToolsResult)}`);
  }
  if (
    upstreamErrorCallResult?.error?.code !== -32099 ||
    upstreamErrorCallResult.error.message !== "upstream error message redacted" ||
    "data" in upstreamErrorCallResult.error ||
    "debug" in upstreamErrorCallResult.error
  ) {
    throw new Error(`unexpected sanitized upstream error response: ${JSON.stringify(upstreamErrorCallResult)}`);
  }
  const upstreamErrorOutputText = upstreamErrorOutputLines.map((line) => JSON.stringify(line)).join("\n");
  if (
    upstreamErrorOutputText.includes("REDACT_ME_UPSTREAM_ERROR_MARKER") ||
    upstreamErrorOutputText.includes("REDACT_ME_UPSTREAM_ERROR_DATA_MARKER") ||
    upstreamErrorOutputText.includes("REDACT_ME_UPSTREAM_ERROR_DEBUG_MARKER")
  ) {
    throw new Error("raw upstream error marker leaked into client output");
  }
  const upstreamErrorAudit = readFileSync(upstreamErrorAuditLog, "utf8");
  if (
    upstreamErrorAudit.includes("REDACT_ME_UPSTREAM_ERROR_MARKER") ||
    upstreamErrorAudit.includes("REDACT_ME_UPSTREAM_ERROR_DATA_MARKER") ||
    upstreamErrorAudit.includes("REDACT_ME_UPSTREAM_ERROR_DEBUG_MARKER") ||
    upstreamErrorAudit.includes("RAW_STDERR_MARKER")
  ) {
    throw new Error("raw upstream error or stderr marker leaked into audit log");
  }
  if (!upstreamErrorAudit.includes('"code":"jsonrpc.upstream_error_redacted"')) {
    throw new Error(`expected upstream error redaction audit event, got ${upstreamErrorAudit}`);
  }
  if (!upstreamErrorAudit.includes('"jsonrpc_error_data":1') || !upstreamErrorAudit.includes('"jsonrpc_error_message":1')) {
    throw new Error(`expected upstream error redaction counts, got ${upstreamErrorAudit}`);
  }

  const pingChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      pingAuditLog,
      "--",
      process.execPath,
      "scripts/fixture-mcp-server.mjs",
      "--server-ping-on-tools-list"
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  const pingStdoutChunks = [];
  const pingStderrChunks = [];
  const pingOutputLines = [];
  pingChild.stdout.on("data", (chunk) => pingStdoutChunks.push(chunk));
  pingChild.stderr.on("data", (chunk) => pingStderrChunks.push(chunk));
  const waitForServerPing = waitForJsonLine(pingChild.stdout, (line) => {
    pingOutputLines.push(line);
    return line.id === "live-server-origin-ping";
  });
  pingChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "ping-tools", method: "tools/list" })}\n`);
  await waitForServerPing;
  pingChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "live-server-origin-ping", result: {} })}\n`);
  pingChild.stdin.end();
  const pingExitCode = await new Promise((resolve, reject) => {
    pingChild.once("error", reject);
    pingChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (pingExitCode !== 0) {
    throw new Error(`expected server-origin ping live run smoke to exit 0, got ${pingExitCode}: ${Buffer.concat(pingStderrChunks).toString("utf8")}`);
  }
  for (const line of Buffer.concat(pingStdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))) {
    if (!pingOutputLines.some((item) => item.id === line.id)) {
      pingOutputLines.push(line);
    }
  }
  const pingToolsResult = pingOutputLines.find((line) => line.id === "ping-tools");
  const serverPingResult = pingOutputLines.find((line) => line.id === "live-server-origin-ping");
  if (!pingToolsResult || pingToolsResult.result.tools.length !== 1 || pingToolsResult.result.tools[0].name !== "read_file") {
    throw new Error(`unexpected server-origin ping filtered tools response: ${JSON.stringify(pingToolsResult)}`);
  }
  if (serverPingResult?.method !== "ping" || "params" in serverPingResult) {
    throw new Error(`unexpected forwarded server-origin ping response: ${JSON.stringify(serverPingResult)}`);
  }
  const pingAudit = readFileSync(pingAuditLog, "utf8");
  if (pingAudit.includes("RAW_STDERR_MARKER") || pingAudit.includes("RAW_PING_ACK_MARKER")) {
    throw new Error("raw server-origin ping fixture stderr leaked into audit log");
  }
  if (!pingAudit.includes('"stderr_line":2')) {
    throw new Error(`expected server-origin ping ack stderr summary audit event, got ${pingAudit}`);
  }

  const deniedPingChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      deniedPingAuditLog,
      "--",
      process.execPath,
      "scripts/fixture-mcp-server.mjs",
      "--server-ping-with-params-on-tools-list"
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  const deniedPingStdoutChunks = [];
  const deniedPingStderrChunks = [];
  deniedPingChild.stdout.on("data", (chunk) => deniedPingStdoutChunks.push(chunk));
  deniedPingChild.stderr.on("data", (chunk) => deniedPingStderrChunks.push(chunk));
  deniedPingChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "denied-ping-tools", method: "tools/list" })}\n`);
  deniedPingChild.stdin.end();
  const deniedPingExitCode = await new Promise((resolve, reject) => {
    deniedPingChild.once("error", reject);
    deniedPingChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (deniedPingExitCode !== 0) {
    throw new Error(
      `expected denied server-origin ping live run smoke to exit 0, got ${deniedPingExitCode}: ${Buffer.concat(deniedPingStderrChunks).toString("utf8")}`
    );
  }
  const deniedPingOutputLines = Buffer.concat(deniedPingStdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  const deniedPingToolsResult = deniedPingOutputLines.find((line) => line.id === "denied-ping-tools");
  const deniedServerPingResult = deniedPingOutputLines.find((line) => line.id === "live-server-origin-ping-with-params");
  if (
    !deniedPingToolsResult ||
    deniedPingToolsResult.result.tools.length !== 1 ||
    deniedPingToolsResult.result.tools[0].name !== "read_file"
  ) {
    throw new Error(`unexpected denied server-origin ping filtered tools response: ${JSON.stringify(deniedPingToolsResult)}`);
  }
  if (deniedServerPingResult) {
    throw new Error(`server-origin ping with params leaked to client stdout: ${JSON.stringify(deniedServerPingResult)}`);
  }
  const deniedPingOutputText = deniedPingOutputLines.map((line) => JSON.stringify(line)).join("\n");
  if (deniedPingOutputText.includes("RAW_SERVER_PING_PARAMS_MARKER")) {
    throw new Error("raw server-origin ping params leaked into client output");
  }
  const deniedPingAudit = readFileSync(deniedPingAuditLog, "utf8");
  if (deniedPingAudit.includes("RAW_SERVER_PING_PARAMS_MARKER") || deniedPingAudit.includes("RAW_PING_DENY_ACK_MARKER")) {
    throw new Error("raw denied server-origin ping fixture content leaked into audit log");
  }
  if (!deniedPingAudit.includes('"code":"method.server_origin_ping_params"')) {
    throw new Error(`expected server-origin ping params denial audit event, got ${deniedPingAudit}`);
  }
  if (!deniedPingAudit.includes('"stderr_line":1')) {
    throw new Error(`expected denied server-origin ping stderr summary audit event, got ${deniedPingAudit}`);
  }

  const failedChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      failedAuditLog,
      "--",
      process.execPath,
      "scripts/fixture-mcp-server.mjs",
      "--exit-nonzero"
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  failedChild.stdin.end();
  const failedExitCode = await new Promise((resolve, reject) => {
    failedChild.once("error", reject);
    failedChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (failedExitCode !== 4) {
    throw new Error(`expected non-zero upstream exit to map to 4, got ${failedExitCode}`);
  }
  const failedAudit = readFileSync(failedAuditLog, "utf8");
  if (!failedAudit.includes("upstream process exited with code 19")) {
    throw new Error(`expected upstream exit audit event, got ${failedAudit}`);
  }

  const secretChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/secret-labels.json",
      "--profile",
      "local",
      "--audit-log",
      secretAuditLog,
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
  const secretStdoutChunks = [];
  const secretStderrChunks = [];
  const secretOutputLines = [];
  secretChild.stdout.on("data", (chunk) => secretStdoutChunks.push(chunk));
  secretChild.stderr.on("data", (chunk) => secretStderrChunks.push(chunk));
  const waitForSecretTools = waitForJsonLine(secretChild.stdout, (line) => {
    secretOutputLines.push(line);
    return line.id === "secret-tools";
  });
  secretChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "secret-tools", method: "tools/list" })}\n`);
  await waitForSecretTools;
  secretChild.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "secret-call",
      method: "tools/call",
      params: {
        name: "read_secret",
        arguments: {
          ["api" + "Key"]: "RAW_LIVE_SECRET_ARGUMENT_MARKER"
        }
      }
    })}\n`
  );
  secretChild.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "secret-denied",
      method: "tools/call",
      params: {
        name: "read_secret",
        arguments: {
          token: "RAW_LIVE_DENIED_SECRET_ARGUMENT_MARKER"
        }
      }
    })}\n`
  );
  secretChild.stdin.end();
  const secretExitCode = await new Promise((resolve, reject) => {
    secretChild.once("error", reject);
    secretChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (secretExitCode !== 0) {
    throw new Error(`expected secret-label live run smoke to exit 0, got ${secretExitCode}: ${Buffer.concat(secretStderrChunks).toString("utf8")}`);
  }
  for (const line of Buffer.concat(secretStdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))) {
    if (!secretOutputLines.some((item) => item.id === line.id)) {
      secretOutputLines.push(line);
    }
  }
  const secretToolsResult = secretOutputLines.find((line) => line.id === "secret-tools");
  const secretCallResult = secretOutputLines.find((line) => line.id === "secret-call");
  const secretDeniedResult = secretOutputLines.find((line) => line.id === "secret-denied");
  if (!secretToolsResult || secretToolsResult.result.tools.length !== 1 || secretToolsResult.result.tools[0].name !== "read_secret") {
    throw new Error(`unexpected secret filtered tools response: ${JSON.stringify(secretToolsResult)}`);
  }
  if (secretCallResult?.error || !secretCallResult?.result) {
    throw new Error(`unexpected secret call response: ${JSON.stringify(secretCallResult)}`);
  }
  if (!secretDeniedResult?.error?.data?.decision || secretDeniedResult.error.data.decision.action !== "deny") {
    throw new Error(`unexpected denied secret call response: ${JSON.stringify(secretDeniedResult)}`);
  }
  const secretOutputText = secretOutputLines.map((line) => JSON.stringify(line)).join("\n");
  if (secretOutputText.includes("RAW_LIVE_DENIED_SECRET_ARGUMENT_MARKER")) {
    throw new Error("raw denied secret-like live run argument leaked into MCP output");
  }
  const secretAudit = readFileSync(secretAuditLog, "utf8");
  if (secretAudit.includes("RAW_LIVE_SECRET_ARGUMENT_MARKER")) {
    throw new Error("raw secret-like live run argument leaked into audit log");
  }
  if (secretAudit.includes("RAW_LIVE_DENIED_SECRET_ARGUMENT_MARKER")) {
    throw new Error("raw denied secret-like live run argument leaked into audit log");
  }
  if (!secretAudit.includes('"ruleId":"allow-api-key-secret"')) {
    throw new Error(`expected secret allow audit event, got ${secretAudit}`);
  }
  if (!secretAudit.includes('"code":"policy.default_deny"')) {
    throw new Error(`expected secret deny audit event, got ${secretAudit}`);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function waitForJsonLine(stream, predicate) {
  let buffer = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.length === 0) {
          continue;
        }
        let parsed;
        try {
          parsed = JSON.parse(part);
        } catch (error) {
          cleanup();
          reject(error);
          return;
        }
        if (predicate(parsed)) {
          cleanup();
          resolve(parsed);
          return;
        }
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error("stream ended before expected JSON-RPC line"));
    };
    const cleanup = () => {
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
    };
    stream.on("data", onData);
    stream.once("error", onError);
    stream.once("end", onEnd);
  });
}
