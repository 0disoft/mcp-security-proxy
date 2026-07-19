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
  if (summary.schemaVersion !== "msp.registry-onboarding-smoke.v1") {
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
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function registryOnboardingRunnerSource() {
  return String.raw`import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  const cliRoot = join(process.cwd(), "node_modules", "@0disoft", "mcp-security-proxy-cli");
  const clientRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "sdk");
  const serverRoot = join(process.cwd(), "node_modules", "@modelcontextprotocol", "server-filesystem");

  mkdirSync(publicRoot, { recursive: true });
  mkdirSync(privateRoot, { recursive: true });
  writeFileSync(publicFile, "hello from registry onboarding\n", "utf8");
  writeFileSync(privateFile, "private registry fixture\n", "utf8");
  writePolicy(policyPath, publicRoot, auditPath);

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
      "--shutdown-grace-ms",
      "2000",
      "--",
      process.execPath,
      join(serverRoot, "dist", "index.js"),
      fixtureRoot
    ]
  });

  let connected = false;
  let closed = false;
  let tools;
  let allowedRead;
  let deniedRead;
  let operationFailed = false;
  try {
    await client.connect(transport);
    connected = true;
    tools = await client.listTools();
    allowedRead = await client.callTool({ name: "read_text_file", arguments: { path: publicFile } });
    deniedRead = await captureCall(client, "read_text_file", { path: privateFile });
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

  process.stdout.write(
    JSON.stringify({
      schemaVersion: "msp.registry-onboarding-smoke.v1",
      installed,
      connected,
      closed,
      visibleTools,
      allowedRead: allowedText,
      deniedRead,
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
  writeFileSync(
    path,
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
              {
                id: "allow-onboarding-read",
                action: "allow",
                tools: ["read_text_file"],
                paths: { allowedRoots: [normalizePolicyPath(allowedRoot)] }
              },
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
    ) + "\n",
    "utf8"
  );
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
