import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = mkdtempSync(join(tmpdir(), "mcp-security-proxy-ops-feature-flags-"));
const flagsPath = join(tempDir, "flags.json");
const auditLogPath = join(tempDir, "audit.jsonl");
const opsLogPath = join(tempDir, "ops.jsonl");
const responseLines = [];
const stderrChunks = [];
let stdoutBuffer = "";
let child;

try {
  writeFileSync(flagsPath, formatSnapshot(false), "utf8");
  child = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--audit-log",
      auditLogPath,
      "--ops-log",
      opsLogPath,
      "--ops-feature-flags",
      flagsPath,
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
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        responseLines.push(JSON.parse(line));
      }
    }
  });
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  sendRequest({ jsonrpc: "2.0", id: "metrics-disabled", method: "tools/list" });
  await waitForResponse("metrics-disabled");
  if (existsSync(opsLogPath) && readFileSync(opsLogPath, "utf8").length > 0) {
    throw new Error("disabled ops metrics emitted proxy.start");
  }

  atomicReplace(flagsPath, formatSnapshot(true));
  await waitForStderr("ops metrics feature flag applied: enabled");

  atomicReplace(flagsPath, '{"schemaVersion":1,"flags":');
  await waitForStderr("ops feature flag reload rejected: snapshot_reload_failed; keeping last valid snapshot");

  atomicReplace(flagsPath, formatStringSnapshot());
  await waitForStderr("ops feature flag reload rejected: evaluation_failed; keeping last valid snapshot");

  sendRequest({ jsonrpc: "2.0", id: "policy-still-denies", method: "resources/list" });
  const denied = await waitForResponse("policy-still-denies");
  if (denied.error?.data?.decision?.action !== "deny") {
    throw new Error(`feature reload altered policy denial: ${JSON.stringify(denied)}`);
  }

  child.stdin.end();
  const exitCode = await waitForExit(child, 15_000);
  if (exitCode !== 0) {
    throw new Error(`ops feature flag smoke exited ${exitCode}: ${Buffer.concat(stderrChunks).toString("utf8")}`);
  }

  const opsEvents = parseJsonLines(readFileSync(opsLogPath, "utf8"));
  if (opsEvents.some((event) => event.event === "proxy.start")) {
    throw new Error("disabled initial snapshot emitted proxy.start");
  }
  const stopEvents = opsEvents.filter((event) => event.event === "proxy.stop");
  if (stopEvents.length !== 1 || stopEvents[0]?.exitCode !== 0) {
    throw new Error(`last-known-good enabled snapshot did not emit proxy.stop: ${JSON.stringify(opsEvents)}`);
  }

  const auditText = readFileSync(auditLogPath, "utf8");
  if (!auditText.includes('"action":"deny"')) {
    throw new Error("feature reload smoke did not preserve deny-by-default audit evidence");
  }
  for (const text of [Buffer.concat(stderrChunks).toString("utf8"), auditText, JSON.stringify(opsEvents)]) {
    if (text.includes(flagsPath) || text.includes('{"schemaVersion":1,"flags":')) {
      throw new Error("feature reload diagnostics leaked snapshot path or invalid content");
    }
  }
} finally {
  if (child && child.exitCode === null) {
    child.kill();
  }
  rmSync(tempDir, { force: true, recursive: true });
}

function sendRequest(request) {
  child.stdin.write(`${JSON.stringify(request)}\n`);
}

async function waitForResponse(id) {
  return waitForValue(() => responseLines.find((response) => response.id === id), `JSON-RPC response ${id}`, 10_000);
}

async function waitForStderr(text) {
  return waitForValue(
    () => (Buffer.concat(stderrChunks).toString("utf8").includes(text) ? true : undefined),
    `stderr diagnostic ${text}`,
    10_000
  );
}

async function waitForValue(readValue, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = readValue();
    if (value !== undefined) {
      return value;
    }
    if (child?.exitCode !== null) {
      throw new Error(`${label} was not observed before proxy exit ${child?.exitCode}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function atomicReplace(targetPath, text) {
  const stagingPath = join(tempDir, `.${basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(stagingPath, text, "utf8");
  renameSync(stagingPath, targetPath);
}

function formatSnapshot(enabled) {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      flags: {
        "mcp.ops.metrics.enabled": {
          type: "boolean",
          defaultVariant: enabled ? "enabled" : "disabled",
          variants: {
            disabled: false,
            enabled: true
          }
        }
      }
    },
    null,
    2
  )}\n`;
}

function formatStringSnapshot() {
  return `${JSON.stringify(
    {
      schemaVersion: 1,
      flags: {
        "mcp.ops.metrics.enabled": {
          type: "string",
          defaultVariant: "enabled",
          variants: {
            enabled: "yes"
          }
        }
      }
    },
    null,
    2
  )}\n`;
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function waitForExit(processHandle, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      processHandle.kill();
      rejectPromise(new Error("timed out waiting for ops feature flag smoke shutdown"));
    }, timeoutMs);
    timeout.unref?.();
    processHandle.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    processHandle.once("exit", (code) => {
      clearTimeout(timeout);
      resolvePromise(code ?? 1);
    });
  });
}
