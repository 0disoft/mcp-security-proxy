import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const manifestPath = "fixtures/compatibility/manifest.json";
const requiredKinds = new Set([
  "mcp.discovery",
  "mcp.call.allowed",
  "mcp.call.denied",
  "mcp.call.approval-required",
  "audit.redaction",
  "cli.json.check-policy",
  "cli.json.inspect-tools",
  "cli.json.eval-call",
  "library.decision-result",
  "runtime.live-smoke"
]);
const cliCommandByKind = new Map([
  ["cli.json.check-policy", "check-policy"],
  ["cli.json.inspect-tools", "inspect-tools"],
  ["cli.json.eval-call", "eval-call"]
]);
const runtimeCommandByKind = new Map([["runtime.live-smoke", ["node", "scripts/smoke-live-run.mjs"]]]);
const requiredEvidenceIds = new Set([
  "mcp-discovery-basic",
  "mcp-call-file-read-allowed",
  "mcp-call-file-read-denied",
  "mcp-call-file-read-traversal",
  "mcp-call-network-allowed",
  "mcp-call-network-denied",
  "mcp-call-network-ambiguous",
  "mcp-call-shell-denied",
  "mcp-call-secret-denied",
  "mcp-call-secret-api-key-allowed",
  "mcp-call-workflow-approval",
  "audit-decision-denied-redacted",
  "cli-check-policy-local-dev",
  "cli-inspect-tools-local",
  "cli-eval-call-allowed-local",
  "cli-eval-call-denied-local",
  "cli-eval-call-file-read-traversal-local",
  "cli-eval-call-network-allowed-local",
  "cli-eval-call-network-denied-local",
  "cli-eval-call-network-ambiguous-local",
  "cli-eval-call-shell-denied-local",
  "cli-eval-call-secret-denied-local",
  "cli-eval-call-secret-api-key-allowed-local",
  "cli-eval-call-workflow-no-hook-local",
  "cli-eval-call-workflow-approval-hook-local",
  "library-decision-file-read-allowed",
  "library-decision-file-read-denied",
  "library-decision-file-read-traversal",
  "library-decision-network-allowed",
  "library-decision-network-denied",
  "library-decision-network-ambiguous",
  "library-decision-shell-denied",
  "library-decision-secret-denied",
  "library-decision-secret-api-key-allowed",
  "library-decision-workflow-no-hook",
  "library-decision-workflow-approval-hook",
  "runtime-live-stdio-smoke"
]);

const failures = [];
const manifest = readJson(manifestPath);

if (manifest.schemaVersion !== "msp.compatibility-evidence.v1") {
  failures.push(`${manifestPath}: schemaVersion must be msp.compatibility-evidence.v1`);
}

if (manifest.target !== "local-stdio-mvp") {
  failures.push(`${manifestPath}: target must be local-stdio-mvp`);
}

if (!Array.isArray(manifest.evidence)) {
  failures.push(`${manifestPath}: evidence must be an array`);
}

const evidence = Array.isArray(manifest.evidence) ? manifest.evidence : [];
const seenIds = new Set();
const seenKinds = new Set();

for (const item of evidence) {
  if (!item || typeof item !== "object") {
    failures.push(`${manifestPath}: evidence entries must be objects`);
    continue;
  }
  await checkEvidenceEntry(item);
}

for (const kind of requiredKinds) {
  if (!seenKinds.has(kind)) {
    failures.push(`${manifestPath}: missing required compatibility evidence kind ${kind}`);
  }
}
for (const id of requiredEvidenceIds) {
  if (!seenIds.has(id)) {
    failures.push(`${manifestPath}: missing required compatibility evidence id ${id}`);
  }
}

checkCompatibilityEvidenceValidator();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

async function checkEvidenceEntry(item) {
  const id = typeof item.id === "string" ? item.id : "";
  const kind = typeof item.kind === "string" ? item.kind : "";
  const path = typeof item.path === "string" ? item.path : "";

  if (!id) {
    failures.push(`${manifestPath}: evidence entry is missing id`);
  } else if (seenIds.has(id)) {
    failures.push(`${manifestPath}: duplicate evidence id ${id}`);
  } else {
    seenIds.add(id);
  }

  if (!requiredKinds.has(kind)) {
    failures.push(`${id || manifestPath}: unsupported evidence kind ${kind || "<missing>"}`);
  } else {
    seenKinds.add(kind);
  }

  if (kind.startsWith("runtime.")) {
    checkRuntimeFixture(id, kind, item.command);
    return;
  }

  if (!path || !existsSync(join(root, path))) {
    failures.push(`${id || manifestPath}: fixture path does not exist: ${path || "<missing>"}`);
    return;
  }

  if (kind.startsWith("mcp.") || kind.startsWith("cli.") || kind.startsWith("library.")) {
    readJson(path);
  }
  if (kind === "audit.redaction") {
    checkAuditRedactionFixture(id, path);
  }
  if (kind.startsWith("cli.")) {
    checkCliFixture(id, kind, path, item.command);
  }
  if (kind === "library.decision-result") {
    await checkLibraryDecisionFixture(id, path, item);
  }
  if (kind === "mcp.discovery") {
    checkDiscoveryFixture(id, path);
  }
  if (kind === "mcp.call.allowed" || kind === "mcp.call.denied" || kind === "mcp.call.approval-required") {
    checkToolCallFixture(id, path);
  }
}

function checkRuntimeFixture(id, kind, command) {
  if (!checkRuntimeCommandShape(id, kind, command)) {
    return;
  }
  execFileSync(process.execPath, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function checkDiscoveryFixture(id, path) {
  const fixture = readJson(path);
  if (!Array.isArray(fixture.tools)) {
    failures.push(`${id}: discovery fixture must contain a tools array`);
  }
}

function checkToolCallFixture(id, path) {
  const fixture = readJson(path);
  if (fixture.method !== "tools/call") {
    failures.push(`${id}: call fixture method must be tools/call`);
  }
  if (typeof fixture.toolName !== "string") {
    failures.push(`${id}: call fixture must include toolName`);
  }
  if (!Array.isArray(fixture.capabilities)) {
    failures.push(`${id}: call fixture must include capabilities`);
  }
}

function checkAuditRedactionFixture(id, path) {
  const text = readText(path);
  if (text.includes("REDACT_ME_VALUE_123")) {
    failures.push(`${id}: redaction fixture contains raw marker value`);
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    failures.push(`${id}: redaction fixture must contain at least one JSONL event`);
  }
  for (const [index, line] of lines.entries()) {
    const event = parseJsonText(line, `${path}:${index + 1}`);
    if (event?.redaction?.applied !== true) {
      failures.push(`${id}: redaction fixture event ${index + 1} must mark redaction.applied true`);
    }
  }
}

function checkCliFixture(id, kind, path, command) {
  if (!checkCliCommandShape(id, kind, command)) {
    return;
  }
  const output = execFileSync(process.execPath, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  const actual = parseJsonText(output, `${id}: stdout`);
  const expected = readJson(path);
  assertJsonEqual(id, actual, expected);
}

function checkCliCommandShape(id, kind, command) {
  if (!Array.isArray(command) || command.length < 3) {
    failures.push(`${id}: CLI evidence command must invoke the built CLI entrypoint`);
    return false;
  }
  if (command.some((arg) => typeof arg !== "string")) {
    failures.push(`${id}: CLI evidence command arguments must be strings`);
    return false;
  }
  if (command[0] !== "node" || command[1] !== "packages/cli/dist/main.js") {
    failures.push(`${id}: CLI evidence command must invoke node packages/cli/dist/main.js`);
    return false;
  }
  const expectedCommand = cliCommandByKind.get(kind);
  if (!expectedCommand) {
    failures.push(`${id}: CLI evidence kind ${kind || "<missing>"} is not mapped to a command`);
    return false;
  }
  if (command[2] !== expectedCommand) {
    failures.push(`${id}: CLI evidence kind ${kind} must run ${expectedCommand}`);
    return false;
  }
  return true;
}

function checkRuntimeCommandShape(id, kind, command) {
  if (!Array.isArray(command) || command.length < 2) {
    failures.push(`${id}: runtime evidence command must invoke a checked runtime script`);
    return false;
  }
  if (command.some((arg) => typeof arg !== "string")) {
    failures.push(`${id}: runtime evidence command arguments must be strings`);
    return false;
  }
  const expectedCommand = runtimeCommandByKind.get(kind);
  if (!expectedCommand) {
    failures.push(`${id}: runtime evidence kind ${kind || "<missing>"} is not mapped to a command`);
    return false;
  }
  if (stableJson(command) !== stableJson(expectedCommand)) {
    failures.push(`${id}: runtime evidence kind ${kind} must run ${expectedCommand.join(" ")}`);
    return false;
  }
  return true;
}

async function checkLibraryDecisionFixture(id, path, item) {
  if (typeof item.policy !== "string" || typeof item.call !== "string" || typeof item.profile !== "string") {
    failures.push(`${id}: library evidence must include policy, call, and profile`);
    return;
  }
  const { evaluateToolCall } = await import("../packages/core/dist/index.js");
  const policy = readJson(item.policy);
  const call = readJson(item.call);
  if (item.approvalHookAvailable !== undefined && typeof item.approvalHookAvailable !== "boolean") {
    failures.push(`${id}: approvalHookAvailable must be a boolean when present`);
    return;
  }
  const actual = evaluateToolCall({
    policy,
    profileId: item.profile,
    call,
    ...(item.approvalHookAvailable !== undefined ? { approvalHookAvailable: item.approvalHookAvailable } : {})
  });
  const expected = readJson(path);
  assertJsonEqual(id, actual, expected);
}

function assertJsonEqual(id, actual, expected) {
  const actualText = stableJson(actual);
  const expectedText = stableJson(expected);
  if (actualText !== expectedText) {
    failures.push(`${id}: fixture drifted from current implementation`);
  }
}

function readJson(path) {
  return parseJsonText(readText(path), path);
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${label}: invalid JSON`);
    return undefined;
  }
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

function checkCompatibilityEvidenceValidator() {
  const invalidCliCommandFailures = collectCompatibilityFailures(() => {
    checkCliCommandShape("<compatibility-self-test-invalid-cli-command>", "cli.json.eval-call", [
      "node",
      "scripts/not-the-cli.js",
      "eval-call"
    ]);
  });
  if (!invalidCliCommandFailures.some((item) => item.includes("must invoke node packages/cli/dist/main.js"))) {
    failures.push(`compatibility self-test invalid CLI command was not rejected: ${invalidCliCommandFailures.join("; ")}`);
  }

  const mismatchedCliKindFailures = collectCompatibilityFailures(() => {
    checkCliCommandShape("<compatibility-self-test-cli-kind-mismatch>", "cli.json.check-policy", [
      "node",
      "packages/cli/dist/main.js",
      "eval-call"
    ]);
  });
  if (!mismatchedCliKindFailures.some((item) => item.includes("must run check-policy"))) {
    failures.push(`compatibility self-test CLI kind mismatch was not rejected: ${mismatchedCliKindFailures.join("; ")}`);
  }

  const invalidRuntimeCommandFailures = collectCompatibilityFailures(() => {
    checkRuntimeCommandShape("<compatibility-self-test-runtime-kind-mismatch>", "runtime.live-smoke", ["node", "scripts/not-the-smoke.js"]);
  });
  if (!invalidRuntimeCommandFailures.some((item) => item.includes("must run node scripts/smoke-live-run.mjs"))) {
    failures.push(`compatibility self-test runtime command mismatch was not rejected: ${invalidRuntimeCommandFailures.join("; ")}`);
  }
}

function collectCompatibilityFailures(fn) {
  const before = failures.length;
  fn();
  return failures.splice(before);
}
