import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const root = process.cwd();
const publicationsDir = join(root, "docs", "ops", "publications");
const failures = [];
const publicationRecords = [];

if (!existsSync(publicationsDir)) {
  failures.push("docs/ops/publications is missing");
} else {
  for (const name of readdirSync(publicationsDir)
    .filter((item) => item.endsWith(".publication.json"))
    .sort()) {
    const path = `docs/ops/publications/${name}`;
    const record = readJson(path);
    publicationRecords.push({ path, record });
    failures.push(...validatePublicationRecord(path, record));
  }
}

if (publicationRecords.length === 0) {
  failures.push("docs/ops/publications must contain at least one publication record");
} else {
  checkValidator(publicationRecords[0]);
}

checkDocumentationContract();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log(
  `publication records verified for ${publicationRecords.length} release${publicationRecords.length === 1 ? "" : "s"}`
);

function validatePublicationRecord(path, record) {
  const issues = [];
  const add = (message) => issues.push(`${path}: ${message}`);

  if (record?.schemaVersion !== "msp.publication-record.v1") {
    add("schemaVersion must be msp.publication-record.v1");
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
  if (!isExactVersion(record?.observedDistTags?.bootstrap)) {
    add("observedDistTags.bootstrap must be an exact semver");
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

  const releaseRecord = loadReleaseRecord(add, record?.releaseRecord);
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

function loadReleaseRecord(add, path) {
  if (!isSafeRelativePath(path) || !path.startsWith("docs/ops/release-records/") || !path.endsWith(".release.json")) {
    add("releaseRecord must be a safe docs/ops/release-records/*.release.json path");
    return undefined;
  }
  if (!existsSync(join(root, path))) {
    add("releaseRecord path does not exist");
    return undefined;
  }
  return readJson(path);
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
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(item.integrity ?? "")) {
      add(`${prefix}.integrity must be an sha512 SRI value`);
    }
    if (!/^[a-f0-9]{40}$/.test(item.shasum ?? "")) {
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

function checkValidator(sample) {
  const missingPackage = structuredClone(sample.record);
  missingPackage.packages = missingPackage.packages.slice(1);
  const missingFailures = validatePublicationRecord(sample.path, missingPackage);
  if (!missingFailures.some((item) => item.includes("packages must exactly match"))) {
    failures.push("publication record self-test did not reject a missing package");
  }

  const badRunUrl = structuredClone(sample.record);
  badRunUrl.releaseRun.url = "https://example.invalid/run";
  const runFailures = validatePublicationRecord(sample.path, badRunUrl);
  if (!runFailures.some((item) => item.includes("releaseRun.url must match"))) {
    failures.push("publication record self-test did not reject a mismatched run URL");
  }

  const badProvenance = structuredClone(sample.record);
  badProvenance.packages[0].provenance.verifiedByRunId += 1;
  const provenanceFailures = validatePublicationRecord(sample.path, badProvenance);
  if (!provenanceFailures.some((item) => item.includes("verifiedByRunId must match"))) {
    failures.push("publication record self-test did not reject mismatched provenance evidence");
  }
}

function checkDocumentationContract() {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const releaseDoc = readFileSync(join(root, "docs", "ops", "release.md"), "utf8");
  const ciDoc = readFileSync(join(root, "docs", "ops", "ci.md"), "utf8");
  if (!readme.includes("published to npm with provenance")) {
    failures.push("README.md must describe the completed npm provenance publication");
  }
  if (!releaseDoc.includes("docs/ops/publications/*.publication.json")) {
    failures.push("docs/ops/release.md must document publication records");
  }
  if (!ciDoc.includes("publication receipt")) {
    failures.push("docs/ops/ci.md must document publication receipt validation");
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function isExactVersion(value) {
  return typeof value === "string" && /^(?!0\.0\.0$)\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

function isFullCommitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && value.includes("T");
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value) || value.includes("\\")) {
    return false;
  }
  return !value.split("/").some((part) => part === "" || part === "." || part === "..");
}
