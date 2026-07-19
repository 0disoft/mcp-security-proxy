import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const tempDir = mkdtempSync(join(tmpdir(), "mcp-security-proxy-policy-reload-"));
const policyPath = join(tempDir, "policy.json");
const auditLogPath = join(tempDir, "audit.jsonl");
const opsLogPath = join(tempDir, "ops.jsonl");
const privateMarker = "RAW_POLICY_RELOAD_PRIVATE_MARKER";
const responseLines = [];
const stderrChunks = [];
let stdoutBuffer = "";
let child;

try {
  const initialPolicy = JSON.parse(readFileSync(join(repoRoot, "fixtures", "policies", "local-dev.json"), "utf8"));
  const policyWithLocalAudit = {
    ...initialPolicy,
    profiles: initialPolicy.profiles.map((profile) =>
      profile.id === "local"
        ? {
            ...profile,
            audit: {
              ...profile.audit,
              path: auditLogPath
            }
          }
        : profile
    )
  };
  writeFileSync(policyPath, `${JSON.stringify(policyWithLocalAudit, null, 2)}\n`, "utf8");

  child = spawn(
    process.execPath,
    [
      "packages/cli/dist/main.js",
      "run",
      "--policy",
      policyPath,
      "--profile",
      "local",
      "--ops-log",
      opsLogPath,
      "--watch-policy",
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

  await waitForOpsEvent((event) => event.event === "proxy.start");

  sendRequest({ jsonrpc: "2.0", id: "before-reload", method: "tools/list" });
  const beforeReload = await waitForResponse("before-reload");
  const initialToolNames = beforeReload.result?.tools?.map((tool) => tool.name) ?? [];
  if (!initialToolNames.includes("read_file")) {
    throw new Error(`expected read_file before reload, got ${JSON.stringify(initialToolNames)}`);
  }

  const replacementPolicy = {
    ...policyWithLocalAudit,
    profiles: policyWithLocalAudit.profiles.map((profile) =>
      profile.id === "local"
        ? {
            ...profile,
            rules: profile.rules.filter((rule) => rule.id !== "allow-public-files")
          }
        : profile
    )
  };
  atomicReplace(policyPath, `${JSON.stringify(replacementPolicy, null, 2)}\n`);
  const applied = await waitForOpsEvent((event) => event.event === "policy.reload_applied");
  if (applied.revision !== 1 || applied.metrics?.policyReloadsApplied !== 1) {
    throw new Error(`unexpected applied reload event: ${JSON.stringify(applied)}`);
  }

  sendRequest({
    jsonrpc: "2.0",
    id: "call-after-reload",
    method: "tools/call",
    params: {
      name: "read_file",
      arguments: {
        path: "workspace/public/readme.txt"
      }
    }
  });
  const deniedAfterReload = await waitForResponse("call-after-reload");
  if (deniedAfterReload.error?.data?.decision?.evidence?.[0]?.code !== "tool.not_visible") {
    throw new Error(`expected tool.not_visible after reload, got ${JSON.stringify(deniedAfterReload)}`);
  }

  sendRequest({ jsonrpc: "2.0", id: "discovery-after-reload", method: "tools/list" });
  const discoveryAfterReload = await waitForResponse("discovery-after-reload");
  const replacementToolNames = discoveryAfterReload.result?.tools?.map((tool) => tool.name) ?? [];
  if (replacementToolNames.includes("read_file")) {
    throw new Error(`read_file remained visible after reload: ${JSON.stringify(replacementToolNames)}`);
  }

  atomicReplace(policyPath, `{"marker":"${privateMarker}"`);
  const rejected = await waitForOpsEvent(
    (event) => event.event === "policy.reload_rejected" && event.reasonCode === "invalid_policy"
  );
  if (rejected.metrics?.policyReloadsRejected !== 1) {
    throw new Error(`unexpected rejected reload event: ${JSON.stringify(rejected)}`);
  }

  sendRequest({ jsonrpc: "2.0", id: "discovery-after-rejection", method: "tools/list" });
  const discoveryAfterRejection = await waitForResponse("discovery-after-rejection");
  const retainedToolNames = discoveryAfterRejection.result?.tools?.map((tool) => tool.name) ?? [];
  if (retainedToolNames.includes("read_file")) {
    throw new Error(`rejected reload replaced the active policy: ${JSON.stringify(retainedToolNames)}`);
  }

  child.stdin.end();
  const exitCode = await waitForExit(child, 15_000);
  if (exitCode !== 0) {
    throw new Error(`policy reload smoke exited ${exitCode}: ${Buffer.concat(stderrChunks).toString("utf8")}`);
  }

  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  const opsText = readFileSync(opsLogPath, "utf8");
  const auditText = readFileSync(auditLogPath, "utf8");
  for (const [label, text] of [
    ["stderr", stderr],
    ["ops log", opsText],
    ["audit log", auditText]
  ]) {
    if (text.includes(privateMarker) || text.includes(policyPath)) {
      throw new Error(`${label} leaked raw policy reload details`);
    }
  }
  if (!stderr.includes("policy reload applied") || !stderr.includes("policy reload rejected: invalid_policy")) {
    throw new Error(`missing stable policy reload diagnostics: ${stderr}`);
  }
  const stop = parseJsonLines(opsText).find((event) => event.event === "proxy.stop");
  if (stop?.metrics?.policyReloadsApplied !== 1 || stop?.metrics?.policyReloadsRejected !== 1) {
    throw new Error(`proxy.stop did not retain reload metrics: ${JSON.stringify(stop)}`);
  }
} finally {
  if (child && child.exitCode === null) {
    child.kill();
  }
  rmSync(tempDir, { recursive: true, force: true });
}

function sendRequest(request) {
  child.stdin.write(`${JSON.stringify(request)}\n`);
}

async function waitForResponse(id) {
  return waitForValue(
    () => responseLines.find((response) => response.id === id),
    `JSON-RPC response ${String(id)}`,
    10_000
  );
}

async function waitForOpsEvent(predicate) {
  return waitForValue(
    () => {
      if (!existsSync(opsLogPath)) {
        return undefined;
      }
      return parseJsonLines(readFileSync(opsLogPath, "utf8")).find(predicate);
    },
    "ops event",
    45_000
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

function parseJsonLines(text) {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function atomicReplace(targetPath, text) {
  const stagingPath = join(tempDir, `.${basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  writeFileSync(stagingPath, text, "utf8");
  renameSync(stagingPath, targetPath);
}

function waitForExit(processHandle, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      processHandle.kill();
      rejectPromise(new Error("timed out waiting for policy reload smoke shutdown"));
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
