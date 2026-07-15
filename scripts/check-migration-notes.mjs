import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIT_EVENT_SCHEMA_VERSION,
  DECISION_SCHEMA_VERSION,
  POLICY_SCHEMA_VERSION
} from "../packages/contracts/dist/index.js";

const root = process.cwd();
const failures = [];

const migrationGuidePath = "docs/library/migration-guide.md";
const semverPath = "docs/library/semver.md";
const releasePath = "docs/ops/release.md";

const migrationGuide = readText(migrationGuidePath);
const semver = readText(semverPath);
const release = readText(releasePath);

for (const schemaVersion of [POLICY_SCHEMA_VERSION, DECISION_SCHEMA_VERSION, AUDIT_EVENT_SCHEMA_VERSION]) {
  assertIncludes(migrationGuide, schemaVersion, `${migrationGuidePath}: missing current schema version ${schemaVersion}`);
}

for (const phrase of [
  "The first public prerelease is `0.2.0-alpha.1`",
  "policy schema fields, defaults, rule ordering, or matcher semantics",
  "audit event schema fields, redaction behavior, or event classification",
  "public library exports, public type names, or package entrypoints",
  "CLI output, JSON output, exit codes, config precedence, or shell completion behavior",
  "runtime compatibility floors",
  "deny-by-default sample policies or security examples",
  "before and after behavior",
  "rollback or downgrade notes",
  "Keep migration examples free of real secrets, raw prompts, and raw MCP tool arguments"
]) {
  assertIncludes(migrationGuide, phrase, `${migrationGuidePath}: missing migration contract phrase "${phrase}"`);
}

for (const phrase of [
  "Policy, audit, output, or exit-code compatibility changes lack migration notes.",
  "Migration examples include secret-like values or captured sensitive payloads."
]) {
  assertIncludes(migrationGuide, phrase, `${migrationGuidePath}: missing review blocker "${phrase}"`);
}

assertIncludes(semver, "docs/library/migration-guide.md", `${semverPath}: semver policy must link to migration guide`);
assertIncludes(semver, "Policy or audit schema changes ship without a version impact note.", `${semverPath}: missing schema version-impact blocker`);
assertIncludes(release, "Missing migration notes for policy, audit, CLI JSON, exit-code, or public API changes.", `${releasePath}: release blocker must include missing migration notes`);

if (forbiddenExamplePattern().test(migrationGuide)) {
  failures.push(`${migrationGuidePath}: migration examples must not include secret-like placeholder assignments`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

function assertIncludes(text, phrase, failure) {
  if (!text.includes(phrase)) {
    failures.push(failure);
  }
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function forbiddenExamplePattern() {
  return /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/i;
}
