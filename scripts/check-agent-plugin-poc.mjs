import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const pluginRoot = "agent-plugin";
const pluginPath = `${pluginRoot}/plugin.json`;
const mcpPath = `${pluginRoot}/mcp.json`;
const runtimePackagePath = `${pluginRoot}/package.json`;
const policyPath = `${pluginRoot}/config/demo-policy.json`;
const runtimePath = `${pluginRoot}/runtime/demo-mcp-server.mjs`;
const evidencePath = "docs/ops/agent-plugin-compatibility-evidence.md";
const pluginSchema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const mcpSchema = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const plugin = readJson(pluginPath);
const mcp = readJson(mcpPath);
const runtimePackage = readJson(runtimePackagePath);
const policy = readJson(policyPath);
const packageManifest = readJson("packages/cli/package.json");

assertExactKeys(pluginPath, plugin, ["$schema", "description", "homepage", "license", "name", "repository", "version"]);
if (plugin.$schema !== pluginSchema) {
  failures.push(`${pluginPath}: must target the canonical Agent Plugins 1.0.0 schema`);
}
if (plugin.name !== "mcp-security-proxy") {
  failures.push(`${pluginPath}: unexpected plugin name`);
}
if (plugin.version !== packageManifest.version || runtimePackage.version !== packageManifest.version) {
  failures.push(`${pluginPath}: plugin and runtime package versions must match packages/cli/package.json`);
}
if (plugin.license !== packageManifest.license || runtimePackage.license !== packageManifest.license) {
  failures.push(`${pluginPath}: plugin and runtime package licenses must match packages/cli/package.json`);
}
if (runtimePackage.dependencies?.[packageManifest.name] !== packageManifest.version) {
  failures.push(`${runtimePackagePath}: published CLI dependency must be pinned to the plugin version`);
}

assertExactKeys(mcpPath, mcp, ["$schema", "mcpServers"]);
if (mcp.$schema !== mcpSchema) {
  failures.push(`${mcpPath}: must target the canonical Agent Plugins 1.0.0 MCP schema`);
}
const server = mcp.mcpServers?.["mcp-security-proxy-demo"];
assertExactKeys(`${mcpPath}#mcp-security-proxy-demo`, server, ["args", "command", "cwd", "type"]);
if (server?.type !== "stdio" || server?.command !== "node" || server?.cwd !== "${PLUGIN_ROOT}") {
  failures.push(`${mcpPath}: demo server must be a PLUGIN_ROOT-scoped Node.js stdio server`);
}
const expectedArgs = [
  "${PLUGIN_ROOT}/node_modules/@0disoft/mcp-security-proxy-cli/dist/main.js",
  "run",
  "--policy",
  "${PLUGIN_ROOT}/config/demo-policy.json",
  "--profile",
  "agent-plugin-demo",
  "--audit-log",
  "${PLUGIN_DATA}/mcp-security-proxy.audit.jsonl",
  "--",
  "node",
  "${PLUGIN_ROOT}/runtime/demo-mcp-server.mjs"
];
if (JSON.stringify(server?.args) !== JSON.stringify(expectedArgs)) {
  failures.push(`${mcpPath}: distributable demo args drifted`);
}
for (const pluginPathValue of [expectedArgs[3], expectedArgs[10]]) {
  const sourcePath = pluginPathValue.replace("${PLUGIN_ROOT}/", `${pluginRoot}/`);
  if (!existsSync(join(root, sourcePath))) {
    failures.push(`${mcpPath}: missing packaged source path ${sourcePath}`);
  }
}
if (!expectedArgs[0].startsWith("${PLUGIN_ROOT}/node_modules/")) {
  failures.push(`${mcpPath}: CLI entry must resolve from the plugin package dependency tree`);
}
if (!expectedArgs[7].startsWith("${PLUGIN_DATA}/")) {
  failures.push(`${mcpPath}: audit output must resolve under PLUGIN_DATA`);
}

if (policy.defaultAction !== "deny" || policy.profiles?.[0]?.defaultAction !== "deny") {
  failures.push(`${policyPath}: demo policy must remain deny-by-default`);
}
if (
  policy.profiles?.[0]?.id !== "agent-plugin-demo" ||
  JSON.stringify(policy.profiles?.[0]?.rules) !==
    JSON.stringify([{ id: "allow-demo-status-only", action: "allow", tools: ["demo_status"] }])
) {
  failures.push(`${policyPath}: demo policy must allow only the fixed demo_status tool`);
}

const serialized = JSON.stringify({ plugin, mcp, runtimePackage }).toLowerCase();
for (const forbidden of ["token", "password", "api_key", "api-key", "secret", '"env"']) {
  if (serialized.includes(forbidden)) {
    failures.push(`${mcpPath}: forbidden secret-bearing field or value ${forbidden}`);
  }
}
const runtimeSource = readFileSync(join(root, runtimePath), "utf8");
for (const forbidden of ["node:child_process", "node:fs", "node:http", "node:https", "process.env"]) {
  if (runtimeSource.includes(forbidden)) {
    failures.push(`${runtimePath}: demo runtime must not use ${forbidden}`);
  }
}

const evidence = readFileSync(join(root, evidencePath), "utf8").replace(/\s+/gu, " ");
for (const required of [
  "live official Agent Plugins 1.0.0 schemas",
  "installable self-contained demo",
  "does not define marketplace acceptance"
]) {
  if (!evidence.includes(required)) {
    failures.push(`${evidencePath}: missing boundary statement ${required}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function assertExactKeys(path, value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${path}: expected an object`);
    return;
  }
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    failures.push(`${path}: unexpected keys`);
  }
}
