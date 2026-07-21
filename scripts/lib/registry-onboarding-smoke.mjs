import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "./package-consumer-smoke.mjs";

export const registryOnboardingPackages = Object.freeze([
  Object.freeze({ name: "@modelcontextprotocol/sdk", version: "1.29.0" }),
  Object.freeze({ name: "@modelcontextprotocol/server-filesystem", version: "2026.7.4" })
]);

export function runRegistryOnboardingSmoke({ consumerRoot, expectedVersion }) {
  const configPath = join(consumerRoot, "registry-onboarding.config.json");
  const runnerPath = join(consumerRoot, "registry-onboarding.mjs");
  writeJson(configPath, {
    expectedProxyVersion: expectedVersion,
    clientPackage: registryOnboardingPackages[0],
    serverPackage: registryOnboardingPackages[1]
  });
  writeFileSync(runnerPath, registryOnboardingRunnerSource(), "utf8");

  const result = runCommand(process.execPath, [runnerPath, configPath], consumerRoot);
  const summary = JSON.parse(result.stdout);
  assertSummary(summary, expectedVersion);
}

function assertSummary(summary, expectedVersion) {
  if (summary.schemaVersion !== "msp.registry-onboarding-smoke.v2") {
    throw new Error("registry onboarding smoke returned an unknown summary schema");
  }
  if (summary.installed?.proxy !== expectedVersion) {
    throw new Error("registry onboarding smoke used an unexpected proxy version");
  }
  if (
    summary.installed?.client !== registryOnboardingPackages[0].version ||
    summary.installed?.server !== registryOnboardingPackages[1].version
  ) {
    throw new Error("registry onboarding smoke used an unexpected MCP fixture version");
  }
  if (!summary.connected || !summary.closed) {
    throw new Error("registry onboarding smoke did not complete the MCP client lifecycle");
  }
  if (JSON.stringify(summary.visibleTools) !== JSON.stringify(["read_text_file"])) {
    throw new Error("registry onboarding smoke did not filter discovery to the allowed read tool");
  }
  if (summary.allowedRead !== "hello from registry onboarding\n") {
    throw new Error("registry onboarding smoke did not return the allowed public file");
  }
  if (
    summary.deniedRead?.errorCode !== -32001 ||
    summary.deniedRead?.decisionAction !== "deny" ||
    !summary.deniedRead?.evidenceCodes?.includes("policy.default_deny")
  ) {
    throw new Error("registry onboarding smoke did not deny the out-of-scope file before forwarding");
  }
  if (summary.audit?.containsFixtureRoot || summary.audit?.containsRawArguments) {
    throw new Error("registry onboarding smoke audit output exposed fixture paths or raw arguments");
  }
  for (const code of ["discovery.filtered", "policy.rule_allow", "policy.default_deny"]) {
    if (!summary.audit?.evidenceCodes?.includes(code)) {
      throw new Error(`registry onboarding smoke audit output is missing ${code}`);
    }
  }
  if (
    JSON.stringify(summary.policyReload?.appliedRevisions) !== JSON.stringify([1, 2]) ||
    JSON.stringify(summary.policyReload?.rejectedReasonCodes) !== JSON.stringify(["invalid_policy"]) ||
    summary.policyReload?.visibleAfterApplied ||
    !summary.policyReload?.visibleAfterRestore ||
    summary.policyReload?.deniedAfterApplied?.errorCode !== -32001 ||
    !summary.policyReload?.deniedAfterApplied?.evidenceCodes?.includes("tool.not_visible")
  ) {
    throw new Error("registry onboarding smoke did not preserve atomic policy reload behavior");
  }
  if (
    !summary.ops?.initiallyDisabled ||
    !summary.ops?.featureEnableObserved ||
    !summary.ops?.invalidSnapshotRejected ||
    summary.ops?.containsFixtureRoot ||
    summary.ops?.containsRawDetails ||
    summary.ops?.stopMetrics?.policyReloadsApplied !== 2 ||
    summary.ops?.stopMetrics?.policyReloadsRejected !== 1
  ) {
    throw new Error("registry onboarding smoke did not preserve ops feature flag behavior");
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function registryOnboardingRunnerSource() {
  return String.raw`import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

main().catch(() => {
  console.error("registry onboarding runner failed");
  process.exitCode = 1;
});

async function main() {
  const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
  const fixtureRoot = join(process.cwd(), "registry-onboarding-fixture");
  const publicRoot = join(fixtureRoot, "public");
  const privateRoot = join(fixtureRoot, "private");
  const publicFile = join(publicRoot, "hello.txt");
  const privateFile = join(privateRoot, "private.txt");
  const policyPath = join(fixtureRoot, "policy.json");
  const auditPath = join(fixtureRoot, "audit.jsonl");
  const opsPath = join(fixtureRoot, "ops.jsonl");
  const flagsPath = join(fixtureRoot, "ops-flags.json");
  const privateMarker = "RAW_REGISTRY_RELOAD_PRIVATE_MARKER";
  const cliRoot = join(process.cwd(), "node_modules", "@0disoft", "mcp-security-proxy-cli");
  const clientRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk");
  const serverRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "server-filesystem");

  mkdirSync(publicRoot, { recursive: true });
  mkdirSync(privateRoot, { recursive: true });
  writeFileSync(publicFile, "hello from registry onboarding\n", "utf8");
  writeFileSync(privateFile, "private registry fixture\n", "utf8");
  writePolicy(policyPath, publicRoot, auditPath);
  writeFileSync(flagsPath, formatFeatureFlags(false), "utf8");

  const installed = {
    proxy: readManifestVersion(cliRoot),
    client: readManifestVersion(clientRoot),
    server: readManifestVersion(serverRoot)
  };
  if (
    installed.proxy !== config.expectedProxyVersion ||
    installed.client !== config.clientPackage.version ||
    installed.server !== config.serverPackage.version
  ) {
    throw new Error("installed registry package versions drifted");
  }

  const client = new Client({ name: "msp-registry-onboarding", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      join(cliRoot, "dist", "main.js"),
      "run",
      "--policy",
      policyPath,
      "--profile",
      "onboarding-filesystem",
      "--audit-log",
      auditPath,
      "--ops-log",
      opsPath,
      "--ops-feature-flags",
      flagsPath,
      "--watch-policy",
      "--shutdown-grace-ms",
      "2000",
      "--",
      process.execPath,
      join(serverRoot, "dist", "index.js"),
      fixtureRoot
    ],
    stderr: "pipe"
  });

  let connected = false;
  let closed = false;
  let tools;
  let allowedRead;
  let deniedRead;
  let deniedAfterApplied;
  let visibleAfterApplied;
  let visibleAfterRestore;
  let initiallyDisabled = false;
  let featureEnableObserved = false;
  let invalidSnapshotRejected = false;
  const stderrChunks = [];
  let operationFailed = false;
  try {
    await client.connect(transport);
    connected = true;
    transport.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    tools = await client.listTools();
    allowedRead = await client.callTool({ name: "read_text_file", arguments: { path: publicFile } });
    deniedRead = await captureCall(client, "read_text_file", { path: privateFile });
    initiallyDisabled = !existsSync(opsPath) || readFileSync(opsPath, "utf8").length === 0;

    atomicReplace(flagsPath, formatFeatureFlags(true), fixtureRoot);
    await waitForStderr(stderrChunks, "ops metrics feature flag applied: enabled", transport);
    featureEnableObserved = true;

    atomicReplace(policyPath, formatPolicy(publicRoot, auditPath, false), fixtureRoot);
    await waitForOpsEvent(
      opsPath,
      (event) => event.event === "policy.reload_applied" && event.revision === 1,
      transport
    );
    deniedAfterApplied = await captureCall(client, "read_text_file", { path: publicFile });
    const toolsAfterApplied = await client.listTools();
    visibleAfterApplied = (toolsAfterApplied.tools ?? []).some((tool) => tool.name === "read_text_file");

    atomicReplace(policyPath, '{"marker":"' + privateMarker + '"', fixtureRoot);
    await waitForOpsEvent(
      opsPath,
      (event) => event.event === "policy.reload_rejected" && event.reasonCode === "invalid_policy",
      transport
    );

    atomicReplace(flagsPath, '{"schemaVersion":1,"flags":{"marker":"' + privateMarker + '"', fixtureRoot);
    await waitForStderr(
      stderrChunks,
      "ops feature flag reload rejected: snapshot_reload_failed; keeping last valid snapshot",
      transport
    );
    invalidSnapshotRejected = true;

    atomicReplace(policyPath, formatPolicy(publicRoot, auditPath, true), fixtureRoot);
    await waitForOpsEvent(
      opsPath,
      (event) => event.event === "policy.reload_applied" && event.revision === 2,
      transport
    );
    const toolsAfterRestore = await client.listTools();
    visibleAfterRestore = (toolsAfterRestore.tools ?? []).some((tool) => tool.name === "read_text_file");
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      await client.close();
      closed = true;
    } catch {
      if (!operationFailed) {
        throw new Error("registry onboarding client cleanup failed");
      }
    }
  }

  const auditText = readFileSync(auditPath, "utf8");
  const auditEvents = auditText
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
  const auditStringValues = collectStringValues(auditEvents);
  const visibleTools = (tools?.tools ?? []).map((tool) => tool.name).sort();
  const allowedText = (allowedRead?.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
  const opsText = readFileSync(opsPath, "utf8");
  const opsEvents = parseJsonLines(opsText);
  const stderrText = Buffer.concat(stderrChunks).toString("utf8");
  const opsStringValues = collectStringValues(opsEvents);
  const stopEvent = opsEvents.find((event) => event.event === "proxy.stop");

  process.stdout.write(
    JSON.stringify({
      schemaVersion: "msp.registry-onboarding-smoke.v2",
      installed,
      connected,
      closed,
      visibleTools,
      allowedRead: allowedText,
      deniedRead,
      policyReload: {
        appliedRevisions: opsEvents
          .filter((event) => event.event === "policy.reload_applied")
          .map((event) => event.revision),
        rejectedReasonCodes: opsEvents
          .filter((event) => event.event === "policy.reload_rejected")
          .map((event) => event.reasonCode),
        deniedAfterApplied,
        visibleAfterApplied,
        visibleAfterRestore
      },
      ops: {
        initiallyDisabled,
        featureEnableObserved,
        invalidSnapshotRejected,
        stopMetrics: stopEvent?.metrics,
        containsFixtureRoot: opsStringValues.some(
          (value) => value.includes(fixtureRoot) || value.includes(normalizePolicyPath(fixtureRoot))
        ),
        containsRawDetails:
          opsText.includes(privateMarker) ||
          auditText.includes(privateMarker) ||
          stderrText.includes(privateMarker) ||
          opsText.includes(policyPath) ||
          opsText.includes(flagsPath) ||
          stderrText.includes(policyPath) ||
          stderrText.includes(flagsPath)
      },
      audit: {
        evidenceCodes: auditEvents
          .flatMap((event) => event.decision?.evidence ?? [])
          .map((item) => item.code)
          .sort(),
        containsFixtureRoot: auditStringValues.some(
          (value) => value.includes(fixtureRoot) || value.includes(normalizePolicyPath(fixtureRoot))
        ),
        containsRawArguments: containsForbiddenKey(auditEvents, new Set(["arguments", "params", "rawArguments"]))
      }
    }) + "\n"
  );
}

function readManifestVersion(root) {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
}

function writePolicy(path, allowedRoot, auditPath) {
  writeFileSync(path, formatPolicy(allowedRoot, auditPath, true), "utf8");
}

function formatPolicy(allowedRoot, auditPath, allowRead) {
  return (
    JSON.stringify(
      {
        schemaVersion: "msp.policy.v1",
        defaultAction: "deny",
        methodPolicy: {
          allowedMethods: ["initialize", "notifications/initialized", "ping", "tools/list", "tools/call"],
          denyUnsupported: true
        },
        profiles: [
          {
            id: "onboarding-filesystem",
            defaultAction: "deny",
            rules: [
              ...(allowRead
                ? [
                    {
                      id: "allow-onboarding-read",
                      action: "allow",
                      tools: ["read_text_file"],
                      paths: { allowedRoots: [normalizePolicyPath(allowedRoot)] }
                    }
                  ]
                : []),
              {
                id: "deny-onboarding-write",
                action: "deny",
                capabilities: ["file-write"]
              },
              {
                id: "deny-onboarding-shell",
                action: "deny",
                capabilities: ["shell"]
              }
            ],
            audit: {
              destination: "file",
              path: auditPath,
              onFailure: "fail_closed",
              includeRawArguments: false,
              includeFullPaths: false
            }
          }
        ],
        redaction: {
          detectors: [
            {
              id: "registry-onboarding-redaction",
              kind: "secret_like",
              replacement: "[REDACTED_VALUE]"
            }
          ]
        }
      },
      null,
      2
    ) + "\n"
  );
}

function formatFeatureFlags(enabled) {
  return (
    JSON.stringify(
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
    ) + "\n"
  );
}

function atomicReplace(targetPath, text, directory) {
  const stagingPath = join(
    directory,
    "." + basename(targetPath) + "." + String(process.pid) + "." + String(Date.now()) + ".tmp"
  );
  writeFileSync(stagingPath, text, "utf8");
  renameSync(stagingPath, targetPath);
}

async function waitForStderr(stderrChunks, expectedText, transport) {
  return waitForValue(
    () => (Buffer.concat(stderrChunks).toString("utf8").includes(expectedText) ? true : undefined),
    "stderr diagnostic",
    transport
  );
}

async function waitForOpsEvent(path, predicate, transport) {
  return waitForValue(
    () => (existsSync(path) ? parseJsonLines(readFileSync(path, "utf8")).find(predicate) : undefined),
    "ops event",
    transport
  );
}

async function waitForValue(readValue, label, transport) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const value = readValue();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error("timed out waiting for " + label);
}

function parseJsonLines(text) {
  return text
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

async function captureCall(client, name, args) {
  try {
    await client.callTool({ name, arguments: args });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      errorCode: error?.code,
      decisionAction: error?.data?.decision?.action,
      evidenceCodes: (error?.data?.decision?.evidence ?? []).map((item) => item.code).sort()
    };
  }
}

function normalizePolicyPath(value) {
  return value.replace(/\\/gu, "/");
}

function collectStringValues(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, output);
    }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      collectStringValues(item, output);
    }
  }
  return output;
}

function containsForbiddenKey(value, forbiddenKeys) {
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenKey(item, forbiddenKeys));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value).some(
    ([key, item]) => forbiddenKeys.has(key) || containsForbiddenKey(item, forbiddenKeys)
  );
}
`;
}
