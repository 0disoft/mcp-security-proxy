import { readdirSync, readFileSync } from "node:fs";
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
const cliManifestPath = "packages/cli/package.json";
const publicationsPath = "docs/ops/publications";

const migrationGuide = readText(migrationGuidePath);
const semver = readText(semverPath);
const release = readText(releasePath);
const currentPackageVersion = readJson(cliManifestPath).version;
const latestPublishedVersion = findLatestPublishedVersion();

if (typeof currentPackageVersion !== "string" || currentPackageVersion.length === 0) {
  failures.push(`${cliManifestPath}: package version must be a non-empty string`);
}

if (latestPublishedVersion) {
  assertIncludes(
    migrationGuide,
    `The latest published prerelease is \`${latestPublishedVersion}\``,
    `${migrationGuidePath}: latest published prerelease must be ${latestPublishedVersion}`
  );
}

if (latestPublishedVersion && currentPackageVersion !== latestPublishedVersion) {
  assertIncludes(
    migrationGuide,
    `The approved \`${currentPackageVersion}\` candidate`,
    `${migrationGuidePath}: current package candidate must be ${currentPackageVersion}`
  );
}

for (const schemaVersion of [POLICY_SCHEMA_VERSION, DECISION_SCHEMA_VERSION, AUDIT_EVENT_SCHEMA_VERSION]) {
  assertIncludes(
    migrationGuide,
    schemaVersion,
    `${migrationGuidePath}: missing current schema version ${schemaVersion}`
  );
}

for (const phrase of [
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
assertIncludes(
  semver,
  "Policy or audit schema changes ship without a version impact note.",
  `${semverPath}: missing schema version-impact blocker`
);
assertIncludes(
  release,
  "Missing migration notes for policy, audit, CLI JSON, exit-code, or public API changes.",
  `${releasePath}: release blocker must include missing migration notes`
);

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

function readJson(path) {
  return JSON.parse(readText(path));
}

function findLatestPublishedVersion() {
  const completed = readdirSync(join(root, publicationsPath))
    .filter((name) => name.endsWith(".publication.json"))
    .map((name) => ({ name, record: readJson(join(publicationsPath, name)) }))
    .filter(({ record }) => record.status === "completed");

  if (completed.length === 0) {
    failures.push(`${publicationsPath}: at least one completed publication record is required`);
    return undefined;
  }

  for (const { name, record } of completed) {
    if (typeof record.releaseVersion !== "string" || record.releaseVersion.length === 0) {
      failures.push(`${join(publicationsPath, name)}: releaseVersion must be a non-empty string`);
    }
    if (typeof record.publishedAt !== "string" || Number.isNaN(Date.parse(record.publishedAt))) {
      failures.push(`${join(publicationsPath, name)}: publishedAt must be a valid timestamp`);
    }
  }

  const latest = completed
    .filter(
      ({ record }) =>
        typeof record.releaseVersion === "string" &&
        record.releaseVersion.length > 0 &&
        typeof record.publishedAt === "string" &&
        !Number.isNaN(Date.parse(record.publishedAt))
    )
    .sort((left, right) => Date.parse(right.record.publishedAt) - Date.parse(left.record.publishedAt))[0];

  return latest?.record.releaseVersion;
}

function forbiddenExamplePattern() {
  return /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*["']?[A-Za-z0-9_-]{8,}/i;
}
