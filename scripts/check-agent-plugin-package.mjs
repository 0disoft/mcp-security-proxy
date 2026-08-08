import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { registryUrl } from "./lib/package-consumer-smoke.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const sourceRoot = join(repoRoot, "agent-plugin");
const tempRoot = mkdtempSync(join(tmpdir(), "msp-agent-plugin-"));
const pluginRoot = join(tempRoot, "plugin");
const pluginData = join(tempRoot, "data");

try {
  cpSync(sourceRoot, pluginRoot, {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/u).includes("node_modules")
  });
  mkdirSync(pluginData, { recursive: true });
  installPluginDependencies(pluginRoot);
  await exercisePlugin(pluginRoot, pluginData);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function installPluginDependencies(cwd) {
  const userConfigPath = join(cwd, ".npmrc");
  const globalConfigPath = join(cwd, ".npmrc-global");
  writeFileSync(userConfigPath, "", "utf8");
  writeFileSync(globalConfigPath, "", "utf8");
  const command = process.platform === "win32" ? process.execPath : "npm";
  const prefix =
    process.platform === "win32" ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : [];
  execFileSync(
    command,
    [...prefix, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", `--registry=${registryUrl}`],
    {
      cwd,
      env: isolatedEnvironment({
        NODE_AUTH_TOKEN: "",
        NPM_TOKEN: "",
        NPM_CONFIG_AUDIT: "false",
        NPM_CONFIG_FUND: "false",
        NPM_CONFIG_GLOBALCONFIG: globalConfigPath,
        NPM_CONFIG_REGISTRY: registryUrl,
        NPM_CONFIG_USERCONFIG: userConfigPath
      }),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
      windowsHide: true
    }
  );
}

async function exercisePlugin(pluginDirectory, dataDirectory) {
  const mcp = JSON.parse(readFileSync(join(pluginDirectory, "mcp.json"), "utf8"));
  const server = mcp.mcpServers?.["mcp-security-proxy-demo"];
  if (!server) {
    throw new Error("agent-plugin/mcp.json: missing mcp-security-proxy-demo server");
  }
  const expand = (value) =>
    value.replaceAll("${PLUGIN_ROOT}", pluginDirectory).replaceAll("${PLUGIN_DATA}", dataDirectory);
  const child = spawn(process.execPath, server.args.map(expand), {
    cwd: expand(server.cwd),
    env: isolatedEnvironment(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  const pending = new Map();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-8192);
  });
  createInterface({ input: child.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on("line", (line) => {
    const message = JSON.parse(line);
    const resolver = pending.get(message.id);
    if (resolver) {
      pending.delete(message.id);
      resolver.resolve(message);
    }
  });
  child.once("exit", (code) => {
    for (const resolver of pending.values()) {
      resolver.reject(new Error(`plugin process exited ${code}: ${normalize(stderr)}`));
    }
    pending.clear();
  });

  const initialize = await request(child, pending, 1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "agent-plugin-package-smoke", version: "0.0.0" }
  });
  if (initialize.error || initialize.result?.serverInfo?.name !== "mcp-security-proxy-agent-plugin-demo") {
    throw new Error("installed Agent Plugin failed MCP initialization");
  }
  notify(child, "notifications/initialized");
  const tools = await request(child, pending, 2, "tools/list", {});
  if (JSON.stringify(tools.result?.tools?.map((tool) => tool.name)) !== JSON.stringify(["demo_status"])) {
    throw new Error("installed Agent Plugin did not expose only demo_status");
  }
  const call = await request(child, pending, 3, "tools/call", { name: "demo_status", arguments: {} });
  if (call.result?.content?.[0]?.text !== "MCP Security Proxy demo is running.") {
    throw new Error("installed Agent Plugin demo_status call returned unexpected content");
  }
  child.stdin.end();
  const [exitCode] = await once(child, "exit");
  if (exitCode !== 0) {
    throw new Error(`installed Agent Plugin exited ${exitCode}: ${normalize(stderr)}`);
  }
  const auditPath = join(dataDirectory, "mcp-security-proxy.audit.jsonl");
  if (!existsSync(auditPath) || readFileSync(auditPath, "utf8").trim().length === 0) {
    throw new Error("installed Agent Plugin did not write its audit log under PLUGIN_DATA");
  }
}

function request(child, pending, id, method, params) {
  const response = new Promise((resolveResponse, rejectResponse) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      rejectResponse(new Error(`installed Agent Plugin timed out during ${method}`));
    }, 15_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolveResponse(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        rejectResponse(error);
      }
    });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return response;
}

function notify(child, method) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
}

function isolatedEnvironment(extra = {}) {
  const allowed = new Set(["HOME", "PATH", "PATHEXT", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR"]);
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key, value]) => value !== undefined && allowed.has(key.toUpperCase()))
    ),
    ...extra
  };
}

function normalize(value) {
  return value.replaceAll(tempRoot, "<plugin-smoke-root>").replaceAll(repoRoot, "<repo-root>").trim();
}
