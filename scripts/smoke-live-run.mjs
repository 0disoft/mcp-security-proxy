import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = mkdtempSync(join(tmpdir(), "mcp-security-proxy-"));
const auditLog = join(tempDir, "audit.jsonl");
const auditFailurePath = join(tempDir, "audit-directory");
const auditWarnPolicyPath = join(tempDir, "audit-warn-and-continue-policy.json");
const auditWarnPath = join(tempDir, "audit-warn-directory");
const frameGuardAuditLog = join(tempDir, "frame-guard-audit.jsonl");
const depthGuardAuditLog = join(tempDir, "depth-guard-audit.jsonl");
const malformedDiscoveryAuditLog = join(tempDir, "malformed-discovery-audit.jsonl");
const noisyDiscoveryAuditLog = join(tempDir, "noisy-discovery-audit.jsonl");
const duplicateDiscoveryAuditLog = join(tempDir, "duplicate-discovery-audit.jsonl");
const replacedDiscoveryAuditLog = join(tempDir, "replaced-discovery-audit.jsonl");
const upstreamErrorAuditLog = join(tempDir, "upstream-error-audit.jsonl");
const pingAuditLog = join(tempDir, "ping-audit.jsonl");
const deniedPingAuditLog = join(tempDir, "denied-ping-audit.jsonl");
const failedAuditLog = join(tempDir, "failed-audit.jsonl");
const secretAuditLog = join(tempDir, "secret-audit.jsonl");

try {
  mkdirSync(auditFailurePath);
  mkdirSync(auditWarnPath);

  const auditFailureChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      auditFailurePath,
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
  const auditFailureStdoutChunks = [];
  const auditFailureStderrChunks = [];
  auditFailureChild.stdout.on("data", (chunk) => auditFailureStdoutChunks.push(chunk));
  auditFailureChild.stderr.on("data", (chunk) => auditFailureStderrChunks.push(chunk));
  auditFailureChild.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "audit-failure-denied",
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: {
          path: "workspace/private/secret.txt"
        }
      }
    })}\n`
  );
  auditFailureChild.stdin.end();
  const auditFailureExitCode = await new Promise((resolve, reject) => {
    auditFailureChild.once("error", reject);
    auditFailureChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (auditFailureExitCode !== 5) {
    throw new Error(
      `expected audit write failure to fail closed with exit 5, got ${auditFailureExitCode}: ${Buffer.concat(auditFailureStderrChunks).toString("utf8")}`
    );
  }
  const auditFailureOutput = Buffer.concat(auditFailureStdoutChunks).toString("utf8");
  if (auditFailureOutput.length > 0) {
    throw new Error(`audit write failure emitted MCP stdout before failing closed: ${auditFailureOutput}`);
  }

  const auditWarnPolicy = JSON.parse(readFileSync(resolve(repoRoot, "fixtures/policies/local-dev.json"), "utf8"));
  writeFileSync(
    auditWarnPolicyPath,
    `${JSON.stringify(
      {
        ...auditWarnPolicy,
        profiles: auditWarnPolicy.profiles.map((profile) =>
          profile.id === "local"
            ? {
                ...profile,
                audit: {
                  ...profile.audit,
                  onFailure: "warn_and_continue"
                }
              }
            : profile
        )
      },
      null,
      2
    )}\n`
  );
  const auditWarnChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      auditWarnPolicyPath,
      "--profile",
      "local",
      "--audit-log",
      auditWarnPath,
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
  const auditWarnStdoutChunks = [];
  const auditWarnStderrChunks = [];
  auditWarnChild.stdout.on("data", (chunk) => auditWarnStdoutChunks.push(chunk));
  auditWarnChild.stderr.on("data", (chunk) => auditWarnStderrChunks.push(chunk));
  auditWarnChild.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "audit-warn-denied",
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: {
          path: "workspace/private/secret.txt"
        }
      }
    })}\n`
  );
  auditWarnChild.stdin.end();
  const auditWarnExitCode = await new Promise((resolve, reject) => {
    auditWarnChild.once("error", reject);
    auditWarnChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (auditWarnExitCode !== 0) {
    throw new Error(
      `expected audit warn-and-continue live run smoke to exit 0, got ${auditWarnExitCode}: ${Buffer.concat(auditWarnStderrChunks).toString("utf8")}`
    );
  }
  const auditWarnOutputLines = Buffer.concat(auditWarnStdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  const auditWarnDeniedResult = auditWarnOutputLines.find((line) => line.id === "audit-warn-denied");
  if (!auditWarnDeniedResult?.error?.data?.decision || auditWarnDeniedResult.error.data.decision.action !== "deny") {
    throw new Error(`unexpected audit warn-and-continue denial response: ${JSON.stringify(auditWarnDeniedResult)}`);
  }
  const auditWarnOutputText = auditWarnOutputLines.map((line) => JSON.stringify(line)).join("\n");
  if (auditWarnOutputText.includes("workspace/private/secret.txt")) {
    throw new Error("raw denied path leaked into audit warn-and-continue MCP output");
  }

  const frameGuardChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      frameGuardAuditLog,
      "--max-frame-bytes",
      "64",
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
  const frameGuardStdoutChunks = [];
  const frameGuardStderrChunks = [];
  frameGuardChild.stdout.on("data", (chunk) => frameGuardStdoutChunks.push(chunk));
  frameGuardChild.stderr.on("data", (chunk) => frameGuardStderrChunks.push(chunk));
  frameGuardChild.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "oversized-client-frame",
      method: "ping",
      params: {
        marker: "RAW_OVERSIZED_CLIENT_FRAME_MARKER"
      }
    })}\n`
  );
  frameGuardChild.stdin.end();
  const frameGuardExitCode = await new Promise((resolve, reject) => {
    frameGuardChild.once("error", reject);
    frameGuardChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (frameGuardExitCode !== 0) {
    throw new Error(`expected frame guard live run smoke to exit 0, got ${frameGuardExitCode}: ${Buffer.concat(frameGuardStderrChunks).toString("utf8")}`);
  }
  const frameGuardOutputLines = Buffer.concat(frameGuardStdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  if (
    frameGuardOutputLines.length !== 1 ||
    frameGuardOutputLines[0]?.id !== null ||
    frameGuardOutputLines[0]?.error?.data?.decision?.evidence?.[0]?.code !== "jsonrpc.frame_too_large"
  ) {
    throw new Error(`unexpected oversized frame response: ${JSON.stringify(frameGuardOutputLines)}`);
  }
  const frameGuardOutputText = frameGuardOutputLines.map((line) => JSON.stringify(line)).join("\n");
  if (frameGuardOutputText.includes("RAW_OVERSIZED_CLIENT_FRAME_MARKER")) {
    throw new Error("raw oversized client frame marker leaked into MCP output");
  }
  const frameGuardAudit = readFileSync(frameGuardAuditLog, "utf8");
  if (frameGuardAudit.includes("RAW_OVERSIZED_CLIENT_FRAME_MARKER") || frameGuardAudit.includes("RAW_STDERR_MARKER")) {
    throw new Error("raw oversized client frame or stderr marker leaked into audit log");
  }
  if (!frameGuardAudit.includes('"code":"jsonrpc.frame_too_large"')) {
    throw new Error(`expected frame-too-large audit event, got ${frameGuardAudit}`);
  }

  const depthGuardChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      depthGuardAuditLog,
      "--max-json-depth",
      "4",
      "--",
      process.execPath,
      "scripts/fixture-mcp-server.mjs",
      "--too-deep-tools-list"
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  const depthGuardStdoutChunks = [];
  const depthGuardStderrChunks = [];
  depthGuardChild.stdout.on("data", (chunk) => depthGuardStdoutChunks.push(chunk));
  depthGuardChild.stderr.on("data", (chunk) => depthGuardStderrChunks.push(chunk));
  depthGuardChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "too-deep-tools", method: "tools/list" })}\n`);
  depthGuardChild.stdin.end();
  const depthGuardExitCode = await new Promise((resolve, reject) => {
    depthGuardChild.once("error", reject);
    depthGuardChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (depthGuardExitCode !== 0) {
    throw new Error(`expected depth guard live run smoke to exit 0, got ${depthGuardExitCode}: ${Buffer.concat(depthGuardStderrChunks).toString("utf8")}`);
  }
  const depthGuardOutputText = Buffer.concat(depthGuardStdoutChunks).toString("utf8");
  if (depthGuardOutputText.length > 0) {
    throw new Error(`too-deep upstream response leaked to client output: ${depthGuardOutputText}`);
  }
  const depthGuardAudit = readFileSync(depthGuardAuditLog, "utf8");
  if (depthGuardAudit.includes("RAW_TOO_DEEP_DISCOVERY_MARKER") || depthGuardAudit.includes("RAW_STDERR_MARKER")) {
    throw new Error("raw too-deep upstream response or stderr marker leaked into audit log");
  }
  if (!depthGuardAudit.includes('"code":"jsonrpc.too_deep"')) {
    throw new Error(`expected too-deep audit event, got ${depthGuardAudit}`);
  }

  const malformedDiscoveryChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      malformedDiscoveryAuditLog,
      "--",
      process.execPath,
      "scripts/fixture-mcp-server.mjs",
      "--malformed-tools-list"
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  const malformedDiscoveryStdoutChunks = [];
  const malformedDiscoveryStderrChunks = [];
  malformedDiscoveryChild.stdout.on("data", (chunk) => malformedDiscoveryStdoutChunks.push(chunk));
  malformedDiscoveryChild.stderr.on("data", (chunk) => malformedDiscoveryStderrChunks.push(chunk));
  malformedDiscoveryChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "malformed-tools", method: "tools/list" })}\n`);
  malformedDiscoveryChild.stdin.end();
  const malformedDiscoveryExitCode = await new Promise((resolve, reject) => {
    malformedDiscoveryChild.once("error", reject);
    malformedDiscoveryChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (malformedDiscoveryExitCode !== 0) {
    throw new Error(
      `expected malformed discovery live run smoke to exit 0, got ${malformedDiscoveryExitCode}: ${Buffer.concat(malformedDiscoveryStderrChunks).toString("utf8")}`
    );
  }
  const malformedDiscoveryOutputLines = Buffer.concat(malformedDiscoveryStdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  const malformedDiscoveryToolsResult = malformedDiscoveryOutputLines.find((line) => line.id === "malformed-tools");
  if (!malformedDiscoveryToolsResult || !Array.isArray(malformedDiscoveryToolsResult.result?.tools) || malformedDiscoveryToolsResult.result.tools.length !== 0) {
    throw new Error(`unexpected malformed discovery sanitized response: ${JSON.stringify(malformedDiscoveryToolsResult)}`);
  }
  const malformedDiscoveryOutputText = malformedDiscoveryOutputLines.map((line) => JSON.stringify(line)).join("\n");
  if (
    malformedDiscoveryOutputText.includes("RAW_MALFORMED_DISCOVERY_MARKER") ||
    malformedDiscoveryOutputText.includes("RAW_MALFORMED_DISCOVERY_DEBUG_MARKER")
  ) {
    throw new Error("raw malformed discovery marker leaked into client output");
  }
  const malformedDiscoveryAudit = readFileSync(malformedDiscoveryAuditLog, "utf8");
  if (
    malformedDiscoveryAudit.includes("RAW_MALFORMED_DISCOVERY_MARKER") ||
    malformedDiscoveryAudit.includes("RAW_MALFORMED_DISCOVERY_DEBUG_MARKER") ||
    malformedDiscoveryAudit.includes("RAW_STDERR_MARKER")
  ) {
    throw new Error("raw malformed discovery or stderr marker leaked into audit log");
  }
  if (!malformedDiscoveryAudit.includes('"code":"discovery.filtered"')) {
    throw new Error(`expected malformed discovery filtered audit event, got ${malformedDiscoveryAudit}`);
  }

  const noisyDiscoveryChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      noisyDiscoveryAuditLog,
      "--",
      process.execPath,
      "scripts/fixture-mcp-server.mjs",
      "--noisy-tools-list"
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  const noisyDiscoveryStdoutChunks = [];
  const noisyDiscoveryStderrChunks = [];
  noisyDiscoveryChild.stdout.on("data", (chunk) => noisyDiscoveryStdoutChunks.push(chunk));
  noisyDiscoveryChild.stderr.on("data", (chunk) => noisyDiscoveryStderrChunks.push(chunk));
  noisyDiscoveryChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "noisy-tools", method: "tools/list" })}\n`);
  noisyDiscoveryChild.stdin.end();
  const noisyDiscoveryExitCode = await new Promise((resolve, reject) => {
    noisyDiscoveryChild.once("error", reject);
    noisyDiscoveryChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (noisyDiscoveryExitCode !== 0) {
    throw new Error(
      `expected noisy discovery live run smoke to exit 0, got ${noisyDiscoveryExitCode}: ${Buffer.concat(noisyDiscoveryStderrChunks).toString("utf8")}`
    );
  }
  const noisyDiscoveryOutputLines = Buffer.concat(noisyDiscoveryStdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  const noisyDiscoveryToolsResult = noisyDiscoveryOutputLines.find((line) => line.id === "noisy-tools");
  const noisyTools = noisyDiscoveryToolsResult?.result?.tools;
  const noisyTool = Array.isArray(noisyTools) ? noisyTools[0] : undefined;
  if (!noisyTool || noisyTools.length !== 1 || noisyTool.name !== "read_file" || noisyTool.debug !== undefined || noisyTool._meta !== undefined) {
    throw new Error(`unexpected noisy discovery sanitized response: ${JSON.stringify(noisyDiscoveryToolsResult)}`);
  }
  if ("debug" in noisyDiscoveryToolsResult.result) {
    throw new Error(`noisy discovery result-level debug field leaked: ${JSON.stringify(noisyDiscoveryToolsResult)}`);
  }
  if (
    noisyTool.inputSchema?.properties?.path?.description !== "Path to read." ||
    noisyTool.inputSchema.properties.path.default !== undefined ||
    noisyTool.inputSchema.properties.path.examples !== undefined ||
    noisyTool.inputSchema.$comment !== undefined ||
    noisyTool.inputSchema._meta !== undefined ||
    noisyTool.annotations?.safe !== true ||
    noisyTool.annotations.example !== undefined
  ) {
    throw new Error(`unexpected noisy discovery metadata sanitization: ${JSON.stringify(noisyTool)}`);
  }
  const noisyDiscoveryOutputText = noisyDiscoveryOutputLines.map((line) => JSON.stringify(line)).join("\n");
  for (const marker of [
    "RAW_NOISY_DISCOVERY_DEFAULT_MARKER",
    "RAW_NOISY_DISCOVERY_EXAMPLE_MARKER",
    "RAW_NOISY_DISCOVERY_COMMENT_MARKER",
    "RAW_NOISY_DISCOVERY_SCHEMA_META_MARKER",
    "RAW_NOISY_DISCOVERY_ANNOTATION_EXAMPLE_MARKER",
    "RAW_NOISY_DISCOVERY_TOOL_META_MARKER",
    "RAW_NOISY_DISCOVERY_TOP_LEVEL_MARKER",
    "RAW_NOISY_DISCOVERY_RESULT_MARKER"
  ]) {
    if (noisyDiscoveryOutputText.includes(marker)) {
      throw new Error(`raw noisy discovery marker leaked into client output: ${marker}`);
    }
  }
  const noisyDiscoveryAudit = readFileSync(noisyDiscoveryAuditLog, "utf8");
  if (noisyDiscoveryAudit.includes("RAW_NOISY_DISCOVERY") || noisyDiscoveryAudit.includes("RAW_STDERR_MARKER")) {
    throw new Error("raw noisy discovery or stderr marker leaked into audit log");
  }

  const duplicateDiscoveryChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      duplicateDiscoveryAuditLog,
      "--",
      process.execPath,
      "scripts/fixture-mcp-server.mjs",
      "--duplicate-tools-list"
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  const duplicateDiscoveryStdoutChunks = [];
  const duplicateDiscoveryStderrChunks = [];
  const duplicateDiscoveryOutputLines = [];
  duplicateDiscoveryChild.stdout.on("data", (chunk) => duplicateDiscoveryStdoutChunks.push(chunk));
  duplicateDiscoveryChild.stderr.on("data", (chunk) => duplicateDiscoveryStderrChunks.push(chunk));
  const waitForDuplicateTools = waitForJsonLine(duplicateDiscoveryChild.stdout, (line) => {
    duplicateDiscoveryOutputLines.push(line);
    return line.id === "duplicate-tools";
  });
  duplicateDiscoveryChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "duplicate-tools", method: "tools/list" })}\n`);
  await waitForDuplicateTools;
  duplicateDiscoveryChild.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "duplicate-call",
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: {
          path: "workspace/public/readme.md"
        }
      }
    })}\n`
  );
  duplicateDiscoveryChild.stdin.end();
  const duplicateDiscoveryExitCode = await new Promise((resolve, reject) => {
    duplicateDiscoveryChild.once("error", reject);
    duplicateDiscoveryChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (duplicateDiscoveryExitCode !== 0) {
    throw new Error(
      `expected duplicate discovery live run smoke to exit 0, got ${duplicateDiscoveryExitCode}: ${Buffer.concat(duplicateDiscoveryStderrChunks).toString("utf8")}`
    );
  }
  for (const line of Buffer.concat(duplicateDiscoveryStdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))) {
    if (!duplicateDiscoveryOutputLines.some((item) => item.id === line.id)) {
      duplicateDiscoveryOutputLines.push(line);
    }
  }
  const duplicateDiscoveryToolsResult = duplicateDiscoveryOutputLines.find((line) => line.id === "duplicate-tools");
  const duplicateDiscoveryCallResult = duplicateDiscoveryOutputLines.find((line) => line.id === "duplicate-call");
  const duplicateTools = duplicateDiscoveryToolsResult?.result?.tools;
  if (
    !Array.isArray(duplicateTools) ||
    duplicateTools.length !== 1 ||
    duplicateTools[0].name !== "read_file" ||
    duplicateTools[0].title !== "Read File" ||
    duplicateTools[0].description !== "Read a file from a caller-provided path."
  ) {
    throw new Error(`unexpected duplicate discovery sanitized response: ${JSON.stringify(duplicateDiscoveryToolsResult)}`);
  }
  if (duplicateDiscoveryCallResult?.error || !duplicateDiscoveryCallResult?.result) {
    throw new Error(`expected duplicate discovery to preserve first visible tool callability: ${JSON.stringify(duplicateDiscoveryCallResult)}`);
  }
  const duplicateDiscoveryOutputText = duplicateDiscoveryOutputLines.map((line) => JSON.stringify(line)).join("\n");
  for (const marker of [
    "RAW_DUPLICATE_DESCRIPTOR_TITLE_MARKER",
    "RAW_DUPLICATE_DESCRIPTOR_DESC_MARKER",
    "RAW_DUPLICATE_DESCRIPTOR_SCHEMA_MARKER",
    "RAW_DUPLICATE_DESCRIPTOR_META_MARKER"
  ]) {
    if (duplicateDiscoveryOutputText.includes(marker)) {
      throw new Error(`raw duplicate discovery marker leaked into client output: ${marker}`);
    }
  }
  const duplicateDiscoveryAudit = readFileSync(duplicateDiscoveryAuditLog, "utf8");
  if (duplicateDiscoveryAudit.includes("RAW_DUPLICATE_DESCRIPTOR") || duplicateDiscoveryAudit.includes("RAW_STDERR_MARKER")) {
    throw new Error("raw duplicate discovery or stderr marker leaked into audit log");
  }
  if (!duplicateDiscoveryAudit.includes('"code":"discovery.filtered"')) {
    throw new Error(`expected duplicate discovery filtered audit event, got ${duplicateDiscoveryAudit}`);
  }

  const replacedDiscoveryChild = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      replacedDiscoveryAuditLog,
      "--",
      process.execPath,
      "scripts/fixture-mcp-server.mjs",
      "--replace-tools-list"
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  const replacedDiscoveryStdoutChunks = [];
  const replacedDiscoveryStderrChunks = [];
  const replacedDiscoveryOutputLines = [];
  replacedDiscoveryChild.stdout.on("data", (chunk) => replacedDiscoveryStdoutChunks.push(chunk));
  replacedDiscoveryChild.stderr.on("data", (chunk) => replacedDiscoveryStderrChunks.push(chunk));
  const waitForInitialReplacementTools = waitForJsonLine(replacedDiscoveryChild.stdout, (line) => {
    replacedDiscoveryOutputLines.push(line);
    return line.id === "replace-tools-initial";
  });
  replacedDiscoveryChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "replace-tools-initial", method: "tools/list" })}\n`);
  await waitForInitialReplacementTools;
  const waitForRefreshedReplacementTools = waitForJsonLine(replacedDiscoveryChild.stdout, (line) => {
    replacedDiscoveryOutputLines.push(line);
    return line.id === "replace-tools-refreshed";
  });
  replacedDiscoveryChild.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "replace-tools-refreshed", method: "tools/list" })}\n`);
  await waitForRefreshedReplacementTools;
  replacedDiscoveryChild.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "replace-call-after-hidden",
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: {
          path: "workspace/public/readme.md"
        }
      }
    })}\n`
  );
  replacedDiscoveryChild.stdin.end();
  const replacedDiscoveryExitCode = await new Promise((resolve, reject) => {
    replacedDiscoveryChild.once("error", reject);
    replacedDiscoveryChild.once("exit", (code) => resolve(code ?? 1));
  });
  if (replacedDiscoveryExitCode !== 0) {
    throw new Error(
      `expected replaced discovery live run smoke to exit 0, got ${replacedDiscoveryExitCode}: ${Buffer.concat(replacedDiscoveryStderrChunks).toString("utf8")}`
    );
  }
  for (const line of Buffer.concat(replacedDiscoveryStdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))) {
    if (!replacedDiscoveryOutputLines.some((item) => item.id === line.id)) {
      replacedDiscoveryOutputLines.push(line);
    }
  }
  const initialReplacementToolsResult = replacedDiscoveryOutputLines.find((line) => line.id === "replace-tools-initial");
  const refreshedReplacementToolsResult = replacedDiscoveryOutputLines.find((line) => line.id === "replace-tools-refreshed");
  const replacedDiscoveryCallResult = replacedDiscoveryOutputLines.find((line) => line.id === "replace-call-after-hidden");
  if (
    !initialReplacementToolsResult ||
    initialReplacementToolsResult.result.tools.length !== 1 ||
    initialReplacementToolsResult.result.tools[0].name !== "read_file"
  ) {
    throw new Error(`unexpected initial replacement discovery response: ${JSON.stringify(initialReplacementToolsResult)}`);
  }
  if (!refreshedReplacementToolsResult || refreshedReplacementToolsResult.result.tools.length !== 0) {
    throw new Error(`unexpected refreshed replacement discovery response: ${JSON.stringify(refreshedReplacementToolsResult)}`);
  }
  if (
    !replacedDiscoveryCallResult?.error?.data?.decision ||
    replacedDiscoveryCallResult.error.data.decision.action !== "deny" ||
    !JSON.stringify(replacedDiscoveryCallResult.error.data.decision.evidence).includes("tool was not visible in filtered discovery")
  ) {
    throw new Error(`expected replaced discovery to deny stale visible tool call: ${JSON.stringify(replacedDiscoveryCallResult)}`);
  }
  const replacedDiscoveryOutputText = replacedDiscoveryOutputLines.map((line) => JSON.stringify(line)).join("\n");
  if (replacedDiscoveryOutputText.includes("RAW_REPLACED_DISCOVERY_HIDDEN_TOOL_MARKER")) {
    throw new Error("raw replaced discovery marker leaked into client output");
  }
  const replacedDiscoveryAudit = readFileSync(replacedDiscoveryAuditLog, "utf8");
  if (replacedDiscoveryAudit.includes("RAW_REPLACED_DISCOVERY_HIDDEN_TOOL_MARKER") || replacedDiscoveryAudit.includes("RAW_STDERR_MARKER")) {
    throw new Error("raw replaced discovery or stderr marker leaked into audit log");
  }
  if (!replacedDiscoveryAudit.includes('"code":"discovery.filtered"') || !replacedDiscoveryAudit.includes('"code":"tool.not_visible"')) {
    throw new Error(`expected replaced discovery filter and deny audit events, got ${replacedDiscoveryAudit}`);
  }

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
      "scripts/fixture-mcp-server.mjs",
      "--require-initialized",
      "--reject-request-extra-fields"
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

  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "initialize",
      method: "initialize",
      params: {
        clientInfo: {
          name: "smoke"
        }
      },
      trace: {
        marker: "RAW_CLIENT_REQUEST_EXTRA_FIELD_MARKER_INITIALIZE"
      }
    })}\n`
  );
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: "tools-before-initialized", method: "tools/list" })}\n`);
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      trace: {
        marker: "RAW_CLIENT_REQUEST_EXTRA_FIELD_MARKER_INITIALIZED"
      }
    })}\n`
  );
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: "tools",
      method: "tools/list",
      trace: {
        marker: "RAW_CLIENT_REQUEST_EXTRA_FIELD_MARKER_TOOLS"
      }
    })}\n`
  );
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
  const stderrText = Buffer.concat(stderrChunks).toString("utf8");
  if (stderrText.includes("RAW_REQUEST_EXTRA_FIELD_MARKER")) {
    throw new Error("client request extra fields reached upstream fixture stderr");
  }

  const outputLines = Buffer.concat(stdoutChunks)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));

  const initializeResult = outputLines.find((line) => line.id === "initialize");
  const preInitializedToolsResult = outputLines.find((line) => line.id === "tools-before-initialized");
  const toolsResult = outputLines.find((line) => line.id === "tools");
  const deniedResult = outputLines.find((line) => line.id === "denied");
  if (
    !initializeResult ||
    initializeResult.result?.protocolVersion !== "fixture-protocol-version" ||
    initializeResult.result?.serverInfo?.name !== "fixture-mcp-server"
  ) {
    throw new Error(`unexpected initialize response: ${JSON.stringify(initializeResult)}`);
  }
  if (!preInitializedToolsResult || preInitializedToolsResult.result?.tools?.length !== 0) {
    throw new Error(`expected tools/list before initialized notification to be empty: ${JSON.stringify(preInitializedToolsResult)}`);
  }
  if (!toolsResult || toolsResult.result.tools.length !== 1 || toolsResult.result.tools[0].name !== "read_file") {
    throw new Error(`unexpected filtered tools response: ${JSON.stringify(toolsResult)}`);
  }
  if (!deniedResult?.error?.data?.decision || deniedResult.error.data.decision.action !== "deny") {
    throw new Error(`unexpected denied call response: ${JSON.stringify(deniedResult)}`);
  }
  const outputText = outputLines.map((line) => JSON.stringify(line)).join("\n");
  if (outputText.includes("RAW_CLIENT_REQUEST_EXTRA_FIELD_MARKER") || outputText.includes("RAW_REQUEST_EXTRA_FIELD_MARKER")) {
    throw new Error("client request extra field marker leaked into MCP output");
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
  if (auditText.includes("RAW_CLIENT_REQUEST_EXTRA_FIELD_MARKER") || auditText.includes("RAW_REQUEST_EXTRA_FIELD_MARKER")) {
    throw new Error("client request extra field marker leaked into audit log");
  }
  if (!auditText.includes('"stderr_line":2')) {
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
