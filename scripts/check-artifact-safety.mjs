import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = process.cwd();
const failures = [];

const releaseRecordPattern = /^docs\/ops\/release-records\/(?:public-release\.template\.json|.+\.release\.json)$/;
const placeholderValues = new Set(["UNDECIDED", "UNRECORDED"]);
const forbiddenPathSegments = new Set([
  ".env",
  ".git",
  "build",
  "captures",
  "corpus",
  "dist",
  "exploit",
  "logs",
  "node_modules",
  "private",
  "tmp"
]);
const forbiddenTextMarkers = [
  { name: "private-key-block", pattern: /BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY/ },
  { name: "raw-arguments-field", pattern: /"raw(?:Tool)?Arguments"\s*:/ },
  { name: "raw-prompt-field", pattern: /"rawPrompt"\s*:/ },
  { name: "full-prompt-field", pattern: /"fullPrompt"\s*:/ },
  { name: "environment-value-field", pattern: /"environmentValue"\s*:/ },
  { name: "private-capture-marker", pattern: /private\s+(?:mcp\s+)?capture/i },
  { name: "real-log-marker", pattern: /real\s+(?:user\s+)?log/i },
  { name: "exploit-corpus-marker", pattern: /exploit\s+corpus/i },
  { name: "raw-incident-evidence-marker", pattern: /raw\s+incident\s+evidence/i }
];

const trackedFiles = execFileSync("git", ["ls-files"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
})
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replaceAll("\\", "/"));

const trackedSet = new Set(trackedFiles);

for (const file of trackedFiles) {
  if (file.startsWith("fixtures/")) {
    checkPublicFixtureFile(file);
  }
  if (releaseRecordPattern.test(file)) {
    checkReleaseRecord(file);
  }
}

checkCompatibilityManifest("fixtures/compatibility/manifest.json");

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

function checkPublicFixtureFile(file) {
  checkRepositoryPath(file, `${file}: public fixture path`);
  if (file.startsWith("fixtures/audit/") && !basename(file).includes(".redacted.")) {
    failures.push(`${file}: public audit fixtures must be explicitly redacted`);
  }
  checkTextMarkers(file, `${file}: public fixture`);
}

function checkCompatibilityManifest(path) {
  if (!trackedSet.has(path)) {
    return;
  }
  const manifest = readJson(path);
  if (!Array.isArray(manifest.evidence)) {
    failures.push(`${path}: evidence must be an array`);
    return;
  }

  for (const [index, item] of manifest.evidence.entries()) {
    for (const field of ["path", "policy", "call"]) {
      const value = item?.[field];
      if (typeof value !== "string") {
        continue;
      }
      const label = `${path}: evidence[${index}].${field}`;
      checkRepositoryPath(value, label);
      if (!value.startsWith("fixtures/")) {
        failures.push(`${label}: compatibility fixture references must stay under fixtures/`);
      }
      if (!trackedSet.has(value)) {
        failures.push(`${label}: referenced fixture must be tracked`);
      }
      if (value.startsWith("fixtures/audit/") && !basename(value).includes(".redacted.")) {
        failures.push(`${label}: public audit fixture references must be explicitly redacted`);
      }
    }
  }
}

function checkReleaseRecord(path) {
  checkTextMarkers(path, `${path}: release record`);
  const record = readJson(path);
  const publicPackages = Array.isArray(record.publicPackages) ? record.publicPackages : [];
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts : [];

  for (const [index, item] of publicPackages.entries()) {
    checkOptionalRepositoryPath(item?.workspacePath, `${path}: publicPackages[${index}].workspacePath`);
    checkOptionalArtifactName(item?.artifactName, `${path}: publicPackages[${index}].artifactName`);
  }

  for (const [index, item] of artifacts.entries()) {
    checkOptionalArtifactName(item?.name, `${path}: artifacts[${index}].name`);
    checkOptionalRepositoryPath(item?.source, `${path}: artifacts[${index}].source`);
  }
}

function checkOptionalRepositoryPath(value, label) {
  if (isPlaceholder(value)) {
    return;
  }
  if (typeof value !== "string") {
    failures.push(`${label}: must be a string path or placeholder`);
    return;
  }
  checkRepositoryPath(value, label);
}

function checkOptionalArtifactName(value, label) {
  if (isPlaceholder(value)) {
    return;
  }
  if (typeof value !== "string") {
    failures.push(`${label}: must be a string name or placeholder`);
    return;
  }
  if (value.includes("/") || value.includes("\\") || value.includes("..")) {
    failures.push(`${label}: artifact names must not contain path separators or traversal`);
  }
  checkForbiddenSegments(value, label);
}

function checkRepositoryPath(value, label) {
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    failures.push(`${label}: paths must be repository-relative POSIX paths`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === ".." || segment.length === 0)) {
    failures.push(`${label}: paths must not contain traversal or empty segments`);
  }
  checkForbiddenSegments(value, label);
}

function checkForbiddenSegments(value, label) {
  for (const pathSegment of value.toLowerCase().split(/[\/\\]+/).filter(Boolean)) {
    if (pathSegment === ".env" || pathSegment.startsWith(".env.")) {
      failures.push(`${label}: forbidden public artifact path segment "${pathSegment}"`);
    }
  }
  for (const segment of value.toLowerCase().split(/[/.\\_-]+/).filter(Boolean)) {
    if (forbiddenPathSegments.has(segment)) {
      failures.push(`${label}: forbidden public artifact path segment "${segment}"`);
    }
  }
}

function checkTextMarkers(file, label) {
  const text = readFileSync(join(root, file), "utf8");
  for (const marker of forbiddenTextMarkers) {
    if (marker.pattern.test(text)) {
      failures.push(`${label}: forbidden marker ${marker.name}`);
    }
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function isPlaceholder(value) {
  return typeof value === "string" && placeholderValues.has(value);
}
