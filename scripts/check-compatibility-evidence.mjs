import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const manifestPath = "fixtures/compatibility/manifest.json";
const requiredKinds = new Set([
  "mcp.discovery",
  "mcp.call.allowed",
  "mcp.call.denied",
  "audit.redaction",
  "cli.json.check-policy",
  "cli.json.inspect-tools",
  "cli.json.eval-call",
  "library.decision-result"
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
    checkCliFixture(id, path, item.command);
  }
  if (kind === "library.decision-result") {
    await checkLibraryDecisionFixture(id, path, item);
  }
  if (kind === "mcp.discovery") {
    checkDiscoveryFixture(id, path);
  }
  if (kind === "mcp.call.allowed" || kind === "mcp.call.denied") {
    checkToolCallFixture(id, path);
  }
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

function checkCliFixture(id, path, command) {
  if (!Array.isArray(command) || command.length < 2 || command[0] !== "node") {
    failures.push(`${id}: CLI evidence command must start with node`);
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

async function checkLibraryDecisionFixture(id, path, item) {
  if (typeof item.policy !== "string" || typeof item.call !== "string" || typeof item.profile !== "string") {
    failures.push(`${id}: library evidence must include policy, call, and profile`);
    return;
  }
  const { evaluateToolCall } = await import("../packages/core/dist/index.js");
  const policy = readJson(item.policy);
  const call = readJson(item.call);
  const actual = evaluateToolCall({ policy, profileId: item.profile, call });
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
