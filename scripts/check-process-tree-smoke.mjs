import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = mkdtempSync(join(tmpdir(), "mcp-security-proxy-process-tree-"));
const auditLog = join(tempDir, "audit.jsonl");
const descendantPidPath = join(tempDir, "descendant.pid");
let proxyChild;
let descendantPid;

try {
  proxyChild = spawn(
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
      "--shutdown-grace-ms",
      "1",
      "--",
      process.execPath,
      "scripts/fixture-mcp-server.mjs",
      "--spawn-descendant-and-hang",
      descendantPidPath
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    }
  );
  const stderrChunks = [];
  proxyChild.stderr.on("data", (chunk) => stderrChunks.push(chunk));
  await waitForFile(descendantPidPath, 10_000);
  descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
  if (!Number.isSafeInteger(descendantPid) || descendantPid < 1) {
    throw new Error(`fixture returned invalid descendant PID: ${descendantPid}`);
  }

  proxyChild.stdin.end();
  const exitCode = await waitForChildExit(proxyChild, 10_000);
  if (exitCode !== 4) {
    throw new Error(
      `expected process-tree shutdown smoke to exit 4, got ${exitCode}: ${Buffer.concat(stderrChunks).toString("utf8")}`
    );
  }
  await waitForProcessExit(descendantPid, 10_000);
} finally {
  if (proxyChild?.exitCode === null) {
    proxyChild.kill("SIGKILL");
  }
  if (descendantPid && isProcessAlive(descendantPid)) {
    try {
      process.kill(descendantPid, "SIGKILL");
    } catch {
      // Best-effort fixture cleanup after a failed assertion.
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
}

async function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for fixture file: ${path}`);
    }
    await delay(20);
  }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null) {
    return Promise.resolve(child.exitCode ?? 1);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for proxy process exit"));
    }, timeoutMs);
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code) => {
      cleanup();
      resolve(code ?? 1);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (isProcessAlive(pid)) {
    if (Date.now() >= deadline) {
      throw new Error(`descendant process ${pid} survived proxy shutdown`);
    }
    await delay(20);
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
