import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createPublicationRecordSchemaValidator } from "./publication-record-schema.mjs";

export function validatePublicationRecord({
  root = process.cwd(),
  path,
  record,
  bootstrapPlan = readJson(root, "docs/ops/npm-bootstrap-plan.json"),
  validateShape = createPublicationRecordSchemaValidator(root)
}) {
  const issues = [];
  const add = (message) => issues.push(`${path}: ${message}`);
  const schemaResult = validateShape(record);
  if (!schemaResult.valid) {
    add(`JSON Schema validation failed: ${schemaResult.errors.join("; ")}`);
  }

  if (record?.status !== "completed") {
    add("status must be completed");
  }
  if (!isExactVersion(record?.releaseVersion)) {
    add("releaseVersion must be an exact nonzero semver");
  }
  if (record?.tag !== `v${record?.releaseVersion}`) {
    add("tag must equal v<releaseVersion>");
  }
  if (path !== `docs/ops/publications/${record?.releaseVersion}.publication.json`) {
    add("filename must match releaseVersion");
  }
  if (!isFullCommitSha(record?.releaseCommit)) {
    add("releaseCommit must be a full 40-character Git commit SHA");
  }
  if (record?.registryTarget !== "npmjs.org") {
    add("registryTarget must be npmjs.org");
  }
  if (record?.observedDistTags?.latest !== record?.releaseVersion) {
    add("observedDistTags.latest must equal releaseVersion");
  }
  if (record?.observedDistTags?.bootstrap !== bootstrapPlan.bootstrapVersion) {
    add("observedDistTags.bootstrap must match the completed npm bootstrap plan");
  }
  if (!isIsoDate(record?.publishedAt) || !isIsoDate(record?.recordedAt)) {
    add("publishedAt and recordedAt must be ISO-8601 timestamps");
  } else if (Date.parse(record.recordedAt) < Date.parse(record.publishedAt)) {
    add("recordedAt must not precede publishedAt");
  }

  checkWorkflowRun(add, "releaseRun", record?.releaseRun, "release.yml");
  checkWorkflowRun(add, "registrySmokeRun", record?.registrySmokeRun, "registry-smoke.yml");
  if (record?.releaseRun?.headCommit !== record?.releaseCommit) {
    add("releaseRun.headCommit must equal releaseCommit");
  }
  if (record?.schemaVersion === "msp.publication-record.v2") {
    checkGitHubRelease(add, record);
  } else if (record?.githubRelease !== undefined) {
    add("githubRelease requires msp.publication-record.v2");
  }

  const releaseRecord = loadReleaseRecord(add, root, record?.releaseRecord);
  if (releaseRecord) {
    if (releaseRecord.status !== "approved") {
      add("releaseRecord must reference an approved release record");
    }
    if (releaseRecord.releaseVersion !== record?.releaseVersion) {
      add("releaseRecord releaseVersion must match publication releaseVersion");
    }
    checkPackages(add, record, releaseRecord);
  }

  return issues;
}

export function isExactPublicationVersion(value) {
  return isExactVersion(value);
}

function checkGitHubRelease(add, record) {
  const release = record?.githubRelease;
  if (!release || typeof release !== "object") {
    add("githubRelease must be an object");
    return;
  }
  if (!Number.isSafeInteger(release.id) || release.id <= 0) {
    add("githubRelease.id must be a positive integer");
  }
  if (release.tag !== record.tag) {
    add("githubRelease.tag must equal tag");
  }
  if (!isFullCommitSha(release.tagCommit) || release.tagCommit !== record.releaseCommit) {
    add("githubRelease.tagCommit must equal releaseCommit");
  }
  if (release.draft !== false) {
    add("githubRelease.draft must be false");
  }
  if (release.prerelease !== hasPrerelease(record.releaseVersion)) {
    add("githubRelease.prerelease must match the releaseVersion SemVer channel");
  }
  if (release.url !== `https://github.com/0disoft/mcp-security-proxy/releases/tag/${encodeURIComponent(record.tag)}`) {
    add("githubRelease.url must match the recorded release tag");
  }
  if (!isIsoDate(release.publishedAt) || !isIsoDate(release.observedAt)) {
    add("githubRelease.publishedAt and githubRelease.observedAt must be ISO-8601 timestamps");
  } else {
    if (Date.parse(release.observedAt) < Date.parse(release.publishedAt)) {
      add("githubRelease.observedAt must not precede githubRelease.publishedAt");
    }
    if (Date.parse(release.observedAt) < Date.parse(record.recordedAt)) {
      add("githubRelease.observedAt must not precede recordedAt");
    }
  }
}

function checkWorkflowRun(add, field, run, expectedWorkflow) {
  if (!run || typeof run !== "object") {
    add(`${field} must be an object`);
    return;
  }
  if (run.workflow !== expectedWorkflow) {
    add(`${field}.workflow must be ${expectedWorkflow}`);
  }
  if (!Number.isSafeInteger(run.id) || run.id <= 0) {
    add(`${field}.id must be a positive integer`);
  }
  if (run.conclusion !== "success") {
    add(`${field}.conclusion must be success`);
  }
  if (!isFullCommitSha(run.headCommit)) {
    add(`${field}.headCommit must be a full 40-character Git commit SHA`);
  }
  if (run.url !== `https://github.com/0disoft/mcp-security-proxy/actions/runs/${run.id}`) {
    add(`${field}.url must match the recorded GitHub Actions run id`);
  }
}

function loadReleaseRecord(add, root, path) {
  if (!isSafeRelativePath(path) || !path.startsWith("docs/ops/release-records/") || !path.endsWith(".release.json")) {
    add("releaseRecord must be a safe docs/ops/release-records/*.release.json path");
    return undefined;
  }
  const absolutePath = join(root, path);
  if (!existsSync(absolutePath)) {
    add("releaseRecord path does not exist");
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch {
    add("releaseRecord path must contain valid JSON");
    return undefined;
  }
}

function checkPackages(add, publication, releaseRecord) {
  if (!Array.isArray(publication?.packages)) {
    add("packages must be an array");
    return;
  }
  const expectedNames = releaseRecord.publicPackages.map((item) => item.name).sort();
  const actualNames = publication.packages.map((item) => item?.name).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    add("packages must exactly match releaseRecord.publicPackages");
  }

  const seen = new Set();
  for (const [index, item] of publication.packages.entries()) {
    const prefix = `packages[${index}]`;
    if (!item || typeof item !== "object") {
      add(`${prefix} must be an object`);
      continue;
    }
    if (seen.has(item.name)) {
      add(`${prefix}.name must be unique`);
    }
    seen.add(item.name);
    if (item.version !== publication.releaseVersion) {
      add(`${prefix}.version must equal releaseVersion`);
    }
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(item.integrity ?? "")) {
      add(`${prefix}.integrity must be an sha512 SRI value`);
    }
    if (!/^[a-f0-9]{40}$/u.test(item.shasum ?? "")) {
      add(`${prefix}.shasum must be a 40-character lowercase SHA-1 value`);
    }
    if (item.provenance?.predicateType !== "https://slsa.dev/provenance/v1") {
      add(`${prefix}.provenance.predicateType must be SLSA provenance v1`);
    }
    if (item.provenance?.verifiedByRunId !== publication.registrySmokeRun?.id) {
      add(`${prefix}.provenance.verifiedByRunId must match registrySmokeRun.id`);
    }
  }
}

function isExactVersion(value) {
  return (
    typeof value === "string" &&
    /^(?!0\.0\.0$)(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.test(
      value
    )
  );
}

function isFullCommitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && value.includes("T");
}

function hasPrerelease(version) {
  return typeof version === "string" && version.split("+", 1)[0].includes("-");
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value) || value.includes("\\")) {
    return false;
  }
  return !value.split("/").some((part) => part === "" || part === "." || part === "..");
}

function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}
