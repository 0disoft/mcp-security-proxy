import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

await runProcessTreeScenario("managed-shutdown");
if (process.platform === "win32") {
  await runProcessTreeScenario("abrupt-proxy-termination");
}

console.log(
  process.platform === "win32"
    ? "process-tree smoke passed for managed shutdown and Windows Job Object kill-on-close"
    : "process-tree smoke passed for managed shutdown"
);

async function runProcessTreeScenario(mode) {
  const tempDir = mkdtempSync(join(tmpdir(), `mcp-security-proxy-process-tree-${mode}-`));
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
    await waitForFixtureStartup(descendantPidPath, proxyChild, stderrChunks, 15_000);
    descendantPid = Number(readFileSync(descendantPidPath, "utf8"));
    if (!Number.isSafeInteger(descendantPid) || descendantPid < 1) {
      throw new Error(`fixture returned invalid descendant PID: ${descendantPid}`);
    }

    if (mode === "abrupt-proxy-termination") {
      if (!proxyChild.kill("SIGKILL")) {
        throw new Error("failed to terminate the proxy fixture abruptly");
      }
      await waitForChildExit(proxyChild, 10_000);
    } else {
      proxyChild.stdin.end();
      const exitCode = await waitForChildExit(proxyChild, 10_000);
      if (exitCode !== 4) {
        throw new Error(
          `expected process-tree shutdown smoke to exit 4, got ${exitCode}: ${Buffer.concat(stderrChunks).toString("utf8")}`
        );
      }
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
}

async function waitForFixtureStartup(path, proxyChild, stderrChunks, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (proxyChild.exitCode !== null) {
      const diagnostic = extractSafeContainmentDiagnostic(stderrChunks);
      throw new Error(
        `proxy exited ${proxyChild.exitCode ?? 1} before process-tree fixture startup${diagnostic ? `: ${diagnostic}` : ""}`
      );
    }
    if (Date.now() >= deadline) {
      throw new Error("timed out waiting for process-tree fixture startup");
    }
    await delay(20);
  }
}

function extractSafeContainmentDiagnostic(stderrChunks) {
  const lines = Buffer.concat(stderrChunks)
    .toString("utf8")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("Windows process containment "));
  return lines.at(-1)?.slice(0, 256);
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
