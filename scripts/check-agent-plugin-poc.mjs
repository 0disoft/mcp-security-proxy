import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const pluginPath = "agent-plugin/plugin.json";
const mcpPath = "agent-plugin/mcp.json";
const evidencePath = "docs/ops/agent-plugin-compatibility-evidence.md";
const plugin = readJson(pluginPath);
const mcp = readJson(mcpPath);
const packageManifest = readJson("packages/cli/package.json");

assertExactKeys(pluginPath, plugin, ["description", "homepage", "license", "name", "repository", "version"]);
if (plugin.name !== "mcp-security-proxy") {
  failures.push(`${pluginPath}: unexpected plugin name`);
}
if (plugin.version !== packageManifest.version) {
  failures.push(`${pluginPath}: version must match packages/cli/package.json`);
}
if (plugin.license !== packageManifest.license) {
  failures.push(`${pluginPath}: license must match packages/cli/package.json`);
}

assertExactKeys(mcpPath, mcp, ["mcpServers"]);
const server = mcp.mcpServers?.["mcp-security-proxy-poc"];
assertExactKeys(`${mcpPath}#mcp-security-proxy-poc`, server, ["args", "command"]);
if (server?.command !== "node") {
  failures.push(`${mcpPath}: PoC command must be node`);
}
const expectedArgs = [
  "packages/cli/dist/main.js",
  "run",
  "--policy",
  "fixtures/policies/local-dev.json",
  "--profile",
  "local",
  "--audit-log",
  ".tmp/agent-plugin-poc.audit.jsonl",
  "--",
  "node",
  "scripts/fixture-mcp-server.mjs"
];
if (JSON.stringify(server?.args) !== JSON.stringify(expectedArgs)) {
  failures.push(`${mcpPath}: PoC args drifted`);
}
for (const sourcePath of [expectedArgs[0], expectedArgs[3], expectedArgs[10]]) {
  if (!existsSync(join(root, sourcePath))) {
    failures.push(`${mcpPath}: missing source path ${sourcePath}`);
  }
}

const serialized = JSON.stringify({ plugin, mcp }).toLowerCase();
for (const forbidden of ["token", "password", "api_key", "api-key", "secret", '"env"']) {
  if (serialized.includes(forbidden)) {
    failures.push(`${mcpPath}: forbidden secret-bearing field or value ${forbidden}`);
  }
}
const evidence = readFileSync(join(root, evidencePath), "utf8").replace(/\s+/gu, " ");
for (const required of [
  "user-supplied Agent Plugins",
  "is not distribution-ready",
  "official schema was not refreshed live"
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
