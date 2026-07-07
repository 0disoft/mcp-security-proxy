import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflowPath = ".github/workflows/ci.yml";
const ciDocPath = "docs/ops/ci.md";
const failures = [];

const manifest = readJson("package.json");
const workflow = readText(workflowPath);
const ciDoc = readText(ciDocPath);

const packageManager = parsePackageManager(manifest.packageManager);
const engineFloor = parseNodeEngineFloor(manifest.engines?.node);
const workflowNodeVersion = extractScalar("node-version");
const workflowPnpmVersion = extractCorepackPnpmVersion();

if (packageManager.name !== "pnpm") {
  failures.push("package.json: packageManager must use pnpm for CI parity");
}
if (workflowPnpmVersion !== packageManager.version) {
  failures.push(
    `${workflowPath}: corepack pnpm version ${workflowPnpmVersion || "<missing>"} must match packageManager ${packageManager.version || "<missing>"}`
  );
}
if (!workflowNodeVersion) {
  failures.push(`${workflowPath}: setup-node node-version is missing`);
} else if (!satisfiesNodeFloor(workflowNodeVersion, engineFloor)) {
  failures.push(
    `${workflowPath}: node-version ${workflowNodeVersion} must satisfy package.json engines.node ${manifest.engines?.node || "<missing>"}`
  );
}

assertContains(workflow, "on:\n  pull_request:", `${workflowPath}: pull_request trigger`);
assertContains(workflow, "push:\n    branches:\n      - main", `${workflowPath}: push main trigger`);
assertContains(workflow, "permissions:\n  contents: read", `${workflowPath}: read-only contents permission`);
assertContains(workflow, "cancel-in-progress: true", `${workflowPath}: concurrency cancellation`);
assertContains(workflow, "runs-on: ubuntu-latest", `${workflowPath}: Ubuntu runner`);
assertContains(workflow, "timeout-minutes: 15", `${workflowPath}: bounded timeout`);
assertPinnedAction("actions/checkout");
assertPinnedAction("actions/setup-node");
assertContains(workflow, "pnpm install --frozen-lockfile", `${workflowPath}: frozen lockfile install`);
assertContains(workflow, "pnpm run check", `${workflowPath}: repository check command`);
assertContains(workflow, "git diff --check", `${workflowPath}: diff hygiene command`);

assertContains(ciDoc, `installs Node.js ${workflowNodeVersion}`, `${ciDocPath}: documented Node.js version`);
assertContains(ciDoc, `enables pnpm ${packageManager.version}`, `${ciDocPath}: documented pnpm version`);
assertContains(ciDoc, "runs `pnpm run check`", `${ciDocPath}: documented check command`);
assertContains(ciDoc, "runs `git diff --check`", `${ciDocPath}: documented diff hygiene command`);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

function assertPinnedAction(actionName) {
  const pattern = new RegExp(`uses:\\s*${escapeRegExp(actionName)}@([^\\s#]+)`);
  const match = workflow.match(pattern);
  if (!match) {
    failures.push(`${workflowPath}: missing ${actionName} step`);
    return;
  }
  if (!/^[a-f0-9]{40}$/i.test(match[1])) {
    failures.push(`${workflowPath}: ${actionName} must be pinned to a full commit SHA`);
  }
}

function extractScalar(key) {
  const pattern = new RegExp(`\\b${escapeRegExp(key)}:\\s*([^\\s#]+)`);
  const match = workflow.match(pattern);
  return match?.[1]?.trim();
}

function extractCorepackPnpmVersion() {
  const match = workflow.match(/\bcorepack\s+prepare\s+pnpm@([^\s]+)\s+--activate\b/);
  return match?.[1]?.trim();
}

function parsePackageManager(value) {
  const match = typeof value === "string" ? value.match(/^([^@]+)@(.+)$/) : null;
  if (!match) {
    failures.push("package.json: packageManager must use name@version format");
    return { name: undefined, version: undefined };
  }
  return { name: match[1], version: match[2] };
}

function parseNodeEngineFloor(value) {
  const match = typeof value === "string" ? value.match(/^>=(\d+)\.(\d+)\.(\d+)$/) : null;
  if (!match) {
    failures.push("package.json: engines.node must use >=MAJOR.MINOR.PATCH format");
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function satisfiesNodeFloor(version, floor) {
  if (!floor) {
    return false;
  }
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    failures.push(`${workflowPath}: node-version must use MAJOR.MINOR.PATCH format`);
    return false;
  }
  const actual = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
  if (actual.major !== floor.major) {
    return false;
  }
  if (actual.minor !== floor.minor) {
    return actual.minor > floor.minor;
  }
  return actual.patch >= floor.patch;
}

function assertContains(text, needle, label) {
  if (!needle || !text.includes(needle)) {
    failures.push(label);
  }
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
