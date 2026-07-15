import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { registryUrl, runCommand } from "./lib/package-consumer-smoke.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const sdkPackage = "@modelcontextprotocol/sdk";
const sdkVersion = "1.29.0";
const serverPackage = "@modelcontextprotocol/server-filesystem";
const serverVersion = "2026.7.4";
const fixturePath = "fixtures/compatibility/external-filesystem-stdio.summary.json";
const update = process.argv.includes("--update");

const tempDir = mkdtempSync(join(tmpdir(), "msp-external-fixture-"));

try {
  installExternalPackages(tempDir);
  const actual = runExternalFixture(tempDir);
  const expectedPath = join(repoRoot, fixturePath);
  if (update || !existsSync(expectedPath)) {
    writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    process.exit(0);
  }

  const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
  if (stableJson(forCompatibilityComparison(actual)) !== stableJson(forCompatibilityComparison(expected))) {
    console.error(`${fixturePath}: external MCP fixture drifted from current implementation`);
    console.error("Run `pnpm run external-compatibility -- --update` after reviewing the drift.");
    process.exit(1);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

function forCompatibilityComparison(summary) {
  const comparable = structuredClone(summary);
  if (comparable?.scenarios?.audit) {
    delete comparable.scenarios.audit.stderrLineCount;
  }
  return comparable;
}

function installExternalPackages(cwd) {
  const userConfigPath = join(cwd, ".npmrc");
  const globalConfigPath = join(cwd, ".npmrc-global");
  writeFileSync(userConfigPath, "", "utf8");
  writeFileSync(globalConfigPath, "", "utf8");
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          [sdkPackage]: sdkVersion,
          [serverPackage]: serverVersion
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const npmArgs = [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    `${sdkPackage}@${sdkVersion}`,
    `${serverPackage}@${serverVersion}`
  ];
  const npmCommand = process.platform === "win32" ? process.execPath : "npm";
  const npmCommandPrefix =
    process.platform === "win32" ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : [];
  runCommand(npmCommand, [...npmCommandPrefix, ...npmArgs, `--registry=${registryUrl}`], cwd, {
    NODE_AUTH_TOKEN: "",
    NPM_TOKEN: "",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_GLOBALCONFIG: globalConfigPath,
    NPM_CONFIG_REGISTRY: registryUrl,
    NPM_CONFIG_USERCONFIG: userConfigPath
  });
}

function runExternalFixture(cwd) {
  const configPath = join(cwd, "config.json");
  const runnerPath = join(cwd, "runner.mjs");
  const outputPath = join(cwd, "summary.json");
  const config = {
    repoRoot,
    sdkPackage,
    sdkVersion,
    serverPackage,
    serverVersion,
    outputPath
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  writeFileSync(runnerPath, runnerSource(), "utf8");
  execFileSync(process.execPath, [runnerPath, configPath], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  return JSON.parse(readFileSync(outputPath, "utf8"));
}

function runnerSource() {
  return String.raw`import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const fixtureRoot = join(process.cwd(), "fixture-root");
const publicDir = join(fixtureRoot, "public");
const privateDir = join(fixtureRoot, "private");
const publicFile = join(publicDir, "hello.txt");
const privateFile = join(privateDir, "secret.txt");
const policyPath = join(process.cwd(), "external-policy.json");
const auditLog = join(process.cwd(), "external-audit.jsonl");
const proxyEntry = join(config.repoRoot, "packages", "cli", "dist", "main.js");
const serverEntry = join(process.cwd(), "node_modules", "@modelcontextprotocol", "server-filesystem", "dist", "index.js");

mkdirSync(publicDir, { recursive: true });
mkdirSync(privateDir, { recursive: true });
writeFileSync(publicFile, "hello from external fixture\n", "utf8");
writeFileSync(privateFile, "private fixture value\n", "utf8");
writePolicy(policyPath, publicDir, privateDir, auditLog);

const client = new Client({ name: "msp-external-fixture", version: "0.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    proxyEntry,
    "run",
    "--policy",
    policyPath,
    "--profile",
    "external-filesystem",
    "--audit-log",
    auditLog,
    "--shutdown-grace-ms",
    "2000",
    "--",
    process.execPath,
    serverEntry,
    fixtureRoot
  ]
});

let listResult;
let allowedRead;
let deniedPrivateRead;
let hiddenToolCall;
let clientClosed = false;
try {
  await client.connect(transport);
  listResult = await client.listTools();
  allowedRead = await callTool(client, "read_text_file", { path: publicFile });
  deniedPrivateRead = await callTool(client, "read_text_file", { path: privateFile });
  hiddenToolCall = await callTool(client, "list_allowed_directories", {});
} finally {
  await client.close();
  clientClosed = true;
}

const auditEvents = readAuditEvents(auditLog);
const summary = {
  schemaVersion: "msp.external-fixture-summary.v1",
  target: "external-filesystem-stdio",
  transport: "stdio",
  fixtureSource: "external-mcp",
  client: {
    package: config.sdkPackage,
    version: config.sdkVersion
  },
  server: {
    package: config.serverPackage,
    version: config.serverVersion
  },
  normalization: {
    fixtureRoot: "<external-fixture-root>",
    elapsedMs: 0,
    timestamps: "<timestamp>"
  },
  scenarios: {
    initialize: {
      connected: true
    },
    initialized: {
      accepted: true
    },
    toolsListFiltering: summarizeTools(listResult),
    allowedPublicRead: summarizeCall(allowedRead),
    deniedPrivateRead: summarizeCall(deniedPrivateRead),
    hiddenToolDirectCall: summarizeCall(hiddenToolCall),
    shutdown: {
      clientClosed
    },
    audit: summarizeAudit(auditEvents)
  }
};

writeFileSync(config.outputPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

function writePolicy(path, allowedRoot, deniedRoot, auditPath) {
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
            id: "external-filesystem",
            defaultAction: "deny",
            rules: [
              {
                id: "deny-private-external-fixture",
                action: "deny",
                tools: ["read_text_file"],
                paths: {
                  deniedRoots: [normalizePathForPolicy(deniedRoot)]
                }
              },
              {
                id: "allow-public-external-fixture",
                action: "allow",
                tools: ["read_text_file"],
                paths: {
                  allowedRoots: [normalizePathForPolicy(allowedRoot)]
                }
              },
              {
                id: "deny-file-write-external-fixture",
                action: "deny",
                capabilities: ["file-write"]
              },
              {
                id: "deny-shell-external-fixture",
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
              id: "external-fixture-redaction-marker",
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

async function callTool(client, name, args) {
  try {
    const result = await client.callTool({ name, arguments: args });
    return {
      ok: true,
      result
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        name: error?.name,
        code: error?.code,
        message: error?.message,
        data: error?.data
      }
    };
  }
}

function summarizeTools(result) {
  const names = (result?.tools ?? []).map((tool) => tool.name).sort();
  return {
    visibleToolNames: names,
    visibleCount: names.length,
    includesReadTextFile: names.includes("read_text_file"),
    includesListAllowedDirectories: names.includes("list_allowed_directories")
  };
}

function summarizeCall(call) {
  if (call.ok) {
    const text = extractText(call.result);
    return {
      ok: true,
      textDigest: text === "hello from external fixture\n" ? "external-public-hello" : "unexpected-text",
      contentTypes: (call.result?.content ?? []).map((item) => item.type).sort()
    };
  }

  return {
    ok: false,
    errorCode: call.error?.code,
    decisionAction: call.error?.data?.decision?.action,
    evidenceCodes: (call.error?.data?.decision?.evidence ?? []).map((item) => item.code).sort()
  };
}

function summarizeAudit(events) {
  return {
    eventKinds: events.map((event) => event.kind).sort(),
    evidenceCodes: events.flatMap((event) => event.decision?.evidence ?? []).map((item) => item.code).sort(),
    redactionAppliedCount: events.filter((event) => event.redaction?.applied).length,
    stderrLineCount: events.reduce((sum, event) => sum + (event.redaction?.counts?.stderr_line ?? 0), 0),
    containsRawFixtureRoot: JSON.stringify(events).includes(fixtureRoot)
  };
}

function readAuditEvents(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function extractText(result) {
  return (result?.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
}

function normalizePathForPolicy(value) {
  return value.replace(/\\/gu, "/");
}`;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
