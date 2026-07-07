import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const recordsDir = join(root, "docs", "ops", "release-records");
const requiredValidations = [
  "docs",
  "package-surface",
  "secret-scan",
  "compatibility",
  "license-report",
  "release-readiness",
  "performance-smoke",
  "contract",
  "test",
  "smoke",
  "check"
];

const failures = [];

if (!existsSync(recordsDir)) {
  failures.push("docs/ops/release-records is missing");
} else {
  const releaseRecords = readdirSync(recordsDir)
    .filter((name) => name.endsWith(".release.json"))
    .sort((left, right) => left.localeCompare(right));

  if (releaseRecords.length === 0) {
    checkPrivatePreReleasePosture();
  }

  for (const recordName of releaseRecords) {
    checkReleaseRecord(`docs/ops/release-records/${recordName}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

function checkPrivatePreReleasePosture() {
  const manifests = [
    "package.json",
    ...readdirSync(join(root, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/package.json`)
      .filter((path) => existsSync(join(root, path)))
  ];

  for (const path of manifests) {
    const manifest = readJson(path);
    if (manifest.private !== true) {
      failures.push(`${path}: private must stay true until a release readiness record exists`);
    }
    if (manifest.version !== "0.0.0") {
      failures.push(`${path}: version must stay 0.0.0 until a release readiness record exists`);
    }
  }
}

function checkReleaseRecord(path) {
  const record = readJson(path);
  if (record.schemaVersion !== "msp.release-readiness.v1") {
    failures.push(`${path}: schemaVersion must be msp.release-readiness.v1`);
  }
  if (!["proposed", "approved", "blocked"].includes(record.status)) {
    failures.push(`${path}: status must be proposed, approved, or blocked`);
  }
  if (!isNonPlaceholder(record.releaseVersion)) {
    failures.push(`${path}: releaseVersion must be recorded`);
  }
  if (!isNonPlaceholder(record.registryTarget)) {
    failures.push(`${path}: registryTarget must be recorded`);
  }
  if (!isNonPlaceholder(record.publishCredentialsOwner)) {
    failures.push(`${path}: publishCredentialsOwner must be recorded`);
  }
  if (!Array.isArray(record.publicPackages) || record.publicPackages.length === 0) {
    failures.push(`${path}: publicPackages must contain at least one package`);
  } else {
    for (const [index, item] of record.publicPackages.entries()) {
      for (const field of ["name", "workspacePath", "artifactName"]) {
        if (!isNonPlaceholder(item?.[field])) {
          failures.push(`${path}: publicPackages[${index}].${field} must be recorded`);
        }
      }
    }
  }
  if (!Array.isArray(record.artifacts) || record.artifacts.length === 0) {
    failures.push(`${path}: artifacts must contain at least one artifact`);
  } else {
    for (const [index, item] of record.artifacts.entries()) {
      for (const field of ["name", "source"]) {
        if (!isNonPlaceholder(item?.[field])) {
          failures.push(`${path}: artifacts[${index}].${field} must be recorded`);
        }
      }
    }
  }
  for (const validation of requiredValidations) {
    if (!isNonPlaceholder(record.validation?.[validation])) {
      failures.push(`${path}: validation.${validation} must be recorded`);
    }
  }
  if (!isNonPlaceholder(record.rollback?.lastKnownGoodVersion)) {
    failures.push(`${path}: rollback.lastKnownGoodVersion must be recorded`);
  }
  if (!isNonPlaceholder(record.rollback?.procedure)) {
    failures.push(`${path}: rollback.procedure must be recorded`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function isNonPlaceholder(value) {
  return typeof value === "string" && value.trim().length > 0 && value !== "UNDECIDED" && value !== "UNRECORDED";
}
