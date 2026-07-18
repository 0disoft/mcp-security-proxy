import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { registryUrl } from "./lib/package-consumer-smoke.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const clientPackage = "@modelcontextprotocol/sdk";
const clientVersion = "1.29.0";
const serverPackage = "mcp-server-fetch";
const serverVersion = "2026.7.10";
const fixturePath = "fixtures/compatibility/external-fetch-stdio.summary.json";
const update = process.argv.includes("--update");
const pythonCommand = process.env.MSP_PYTHON || (process.platform === "win32" ? "python" : "python3");
const tempDir = mkdtempSync(join(tmpdir(), "msp-external-fetch-fixture-"));

try {
  installExternalClient(tempDir);
  const venvPython = installFetchServer(tempDir);
  const actual = runExternalFixture(tempDir, venvPython);
  const expectedPath = join(repoRoot, fixturePath);
  if (update || !existsSync(expectedPath)) {
    writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
  } else {
    const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
    if (stableJson(forCompatibilityComparison(actual)) !== stableJson(forCompatibilityComparison(expected))) {
      console.error(`${fixturePath}: external fetch MCP fixture drifted from current implementation`);
      console.error("Run `node scripts/check-external-fetch-mcp-fixture.mjs --update` after reviewing the drift.");
      process.exitCode = 1;
    }
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

function installExternalClient(cwd) {
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
          [clientPackage]: clientVersion
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const npmCommand = process.platform === "win32" ? process.execPath : "npm";
  const npmCommandPrefix =
    process.platform === "win32" ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : [];
  runIsolatedCommand(
    npmCommand,
    [
      ...npmCommandPrefix,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `${clientPackage}@${clientVersion}`,
      `--registry=${registryUrl}`
    ],
    cwd,
    {
      NODE_AUTH_TOKEN: "",
      NPM_TOKEN: "",
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_FUND: "false",
      NPM_CONFIG_GLOBALCONFIG: globalConfigPath,
      NPM_CONFIG_REGISTRY: registryUrl,
      NPM_CONFIG_USERCONFIG: userConfigPath
    }
  );
}

function installFetchServer(cwd) {
  const venvRoot = join(cwd, ".venv");
  const pipConfigPath = join(cwd, "pip.conf");
  writeFileSync(pipConfigPath, "", "utf8");
  runIsolatedCommand(pythonCommand, ["-m", "venv", venvRoot], cwd);
  const venvPython =
    process.platform === "win32" ? join(venvRoot, "Scripts", "python.exe") : join(venvRoot, "bin", "python");
  runIsolatedCommand(
    venvPython,
    [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
      "--only-binary=:all:",
      "--index-url=https://pypi.org/simple",
      `${serverPackage}==${serverVersion}`
    ],
    cwd,
    {
      PIP_CONFIG_FILE: pipConfigPath,
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
      PIP_EXTRA_INDEX_URL: "",
      PIP_INDEX_URL: "https://pypi.org/simple",
      PIP_NO_INPUT: "1",
      PIP_TRUSTED_HOST: ""
    }
  );
  return venvPython;
}

function runExternalFixture(cwd, venvPython) {
  const configPath = join(cwd, "config.json");
  const runnerPath = join(cwd, "runner.mjs");
  const outputPath = join(cwd, "summary.json");
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        repoRoot,
        clientPackage,
        clientVersion,
        serverPackage,
        serverVersion,
        pythonExecutable: venvPython,
        outputPath
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  writeFileSync(runnerPath, runnerSource(), "utf8");
  execFileSync(process.execPath, [runnerPath, configPath], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000
  });
  return JSON.parse(readFileSync(outputPath, "utf8"));
}

function runnerSource() {
  return String.raw`import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const policyPath = join(process.cwd(), "external-fetch-policy.json");
const auditLog = join(process.cwd(), "external-fetch-audit.jsonl");
const proxyEntry = join(config.repoRoot, "packages", "cli", "dist", "main.js");
const fixtureServer = createServer((request, response) => {
  if (request.url === "/public") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("hello from external fetch fixture\n");
    return;
  }
  if (request.url === "/error") {
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("synthetic upstream failure\n");
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("not found\n");
});

await listen(fixtureServer);
const address = fixtureServer.address();
if (!address || typeof address === "string") {
  throw new Error("external fetch fixture did not bind an IP socket");
}
const baseUrl = "http://127.0.0.1:" + address.port;
writePolicy(policyPath, auditLog);

const safeEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) =>
      value !== undefined && ["HOME", "PATH", "SYSTEMROOT", "TEMP", "TMP", "WINDIR"].includes(key.toUpperCase())
  )
);
const client = new Client({ name: "msp-external-fetch-fixture", version: "0.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    proxyEntry,
    "run",
    "--policy",
    policyPath,
    "--profile",
    "external-fetch",
    "--audit-log",
    auditLog,
    "--shutdown-grace-ms",
    "2000",
    "--",
    config.pythonExecutable,
    "-m",
    "mcp_server_fetch",
    "--ignore-robots-txt"
  ],
  env: safeEnvironment
});

let listResult;
let allowedLocalFetch;
let deniedExternalFetch;
let upstreamHttpError;
let clientClosed = false;
try {
  await client.connect(transport);
  listResult = await client.listTools();
  allowedLocalFetch = await callTool(client, "fetch", { url: baseUrl + "/public", raw: true });
  deniedExternalFetch = await callTool(client, "fetch", { url: "http://192.0.2.1/blocked", raw: true });
  upstreamHttpError = await callTool(client, "fetch", { url: baseUrl + "/error", raw: true });
} finally {
  try {
    await client.close();
    clientClosed = true;
  } finally {
    await closeServer(fixtureServer);
  }
}

const auditEvents = readAuditEvents(auditLog);
const summary = {
  schemaVersion: "msp.external-fixture-summary.v1",
  target: "external-fetch-stdio",
  transport: "stdio",
  fixtureSource: "external-mcp",
  client: {
    package: config.clientPackage,
    version: config.clientVersion
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
    allowedLocalFetch: summarizeAllowedFetch(allowedLocalFetch),
    deniedExternalFetch: summarizeDeniedCall(deniedExternalFetch),
    upstreamHttpError: summarizeUpstreamError(upstreamHttpError),
    shutdown: {
      clientClosed
    },
    audit: summarizeAudit(auditEvents)
  }
};

writeFileSync(config.outputPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

function writePolicy(path, auditPath) {
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
            id: "external-fetch",
            defaultAction: "deny",
            rules: [
              {
                id: "allow-local-fetch",
                action: "allow",
                tools: ["fetch"],
                capabilities: ["network"],
                networks: [{ ips: ["127.0.0.1"] }]
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
              id: "external-fetch-redaction-marker",
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

async function callTool(clientInstance, name, args) {
  try {
    return {
      ok: true,
      result: await clientInstance.callTool({ name, arguments: args })
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error?.code,
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
    includesFetch: names.includes("fetch")
  };
}

function summarizeAllowedFetch(call) {
  if (!call.ok || call.result?.isError) {
    return { ok: false, contentDigest: "unexpected-error" };
  }
  const content = call.result?.content ?? [];
  const text = content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("");
  return {
    ok: true,
    contentDigest: text.includes("hello from external fetch fixture")
      ? "external-fetch-hello"
      : "unexpected-content",
    contentTypes: content.map((item) => item.type).sort()
  };
}

function summarizeDeniedCall(call) {
  if (call.ok) {
    return { ok: true, unexpectedlyForwarded: true };
  }
  return {
    ok: false,
    errorCode: call.error?.code,
    decisionAction: call.error?.data?.decision?.action,
    evidenceCodes: (call.error?.data?.decision?.evidence ?? []).map((item) => item.code).sort()
  };
}

function summarizeUpstreamError(call) {
  if (call.ok) {
    return {
      ok: true,
      isError: call.result?.isError === true,
      contentTypes: (call.result?.content ?? []).map((item) => item.type).sort()
    };
  }
  return {
    ok: false,
    errorCode: call.error?.code,
    hasRawErrorData: call.error?.data !== undefined
  };
}

function summarizeAudit(events) {
  return {
    eventKinds: events.map((event) => event.kind).sort(),
    evidenceCodes: events.flatMap((event) => event.decision?.evidence ?? []).map((item) => item.code).sort(),
    redactionAppliedCount: events.filter((event) => event.redaction?.applied).length,
    stderrLineCount: events.reduce((sum, event) => sum + (event.redaction?.counts?.stderr_line ?? 0), 0),
    containsRawFixtureRoot: JSON.stringify(events).includes(process.cwd())
  };
}

function readAuditEvents(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
}

function closeServer(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
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

function runIsolatedCommand(command, args, cwd, extraEnvironment = {}) {
  const allowedEnvironmentNames = new Set([
    "APPDATA",
    "HOME",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR"
  ]);
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && allowedEnvironmentNames.has(key.toUpperCase())
    )
  );
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...environment,
      ...extraEnvironment
    },
    windowsHide: true
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}${details ? `\n${details}` : ""}`);
  }
}
