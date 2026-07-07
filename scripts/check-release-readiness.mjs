import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const root = process.cwd();
const recordsDir = join(root, "docs", "ops", "release-records");
const requiredValidations = [
  "docs",
  "schema-contract",
  "migration-check",
  "package-surface",
  "secret-scan",
  "artifact-safety",
  "repository-hygiene",
  "validation-registry",
  "ci-contract",
  "compatibility",
  "license-report",
  "release-readiness",
  "performance-smoke",
  "contract",
  "test",
  "smoke",
  "check"
];
const requiredReleaseScopeDecisions = ["mcpSdkDependency", "httpTransport", "hostApprovalUx"];
const releaseScopeStatuses = new Set(["included", "excluded"]);
const trackedFiles = new Set(
  execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"))
);

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

checkReleaseRecordValidator();

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
  checkReleaseRecordObject(path, readJson(path));
}

function checkReleaseRecordObject(path, record) {
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
  checkReleaseScope(path, record.releaseScope);
  if (!Array.isArray(record.publicPackages) || record.publicPackages.length === 0) {
    failures.push(`${path}: publicPackages must contain at least one package`);
  } else {
    const seenPackageNames = new Set();
    const seenPackagePaths = new Set();
    for (const [index, item] of record.publicPackages.entries()) {
      if (!item || typeof item !== "object") {
        failures.push(`${path}: publicPackages[${index}] must be an object`);
        continue;
      }
      for (const field of ["name", "workspacePath", "artifactName"]) {
        if (!isNonPlaceholder(item?.[field])) {
          failures.push(`${path}: publicPackages[${index}].${field} must be recorded`);
        }
      }
      if (!isSafeRelativeRepoPath(item?.workspacePath) || !String(item?.workspacePath).startsWith("packages/")) {
        failures.push(`${path}: publicPackages[${index}].workspacePath must be a safe packages/* repo path`);
        continue;
      }
      if (seenPackageNames.has(item.name)) {
        failures.push(`${path}: duplicate public package name ${item.name}`);
      }
      if (seenPackagePaths.has(item.workspacePath)) {
        failures.push(`${path}: duplicate public package workspacePath ${item.workspacePath}`);
      }
      seenPackageNames.add(item.name);
      seenPackagePaths.add(item.workspacePath);
      const packageManifestPath = `${item.workspacePath}/package.json`;
      if (!existsSync(join(root, packageManifestPath))) {
        failures.push(`${path}: publicPackages[${index}].workspacePath must contain package.json`);
        continue;
      }
      const packageManifest = readJson(packageManifestPath);
      if (packageManifest.name !== item.name) {
        failures.push(`${path}: publicPackages[${index}].name must match ${packageManifestPath}`);
      }
      if (packageManifest.version !== record.releaseVersion) {
        failures.push(`${path}: publicPackages[${index}].version must match releaseVersion`);
      }
    }
  }
  if (!Array.isArray(record.artifacts) || record.artifacts.length === 0) {
    failures.push(`${path}: artifacts must contain at least one artifact`);
  } else {
    const seenArtifactNames = new Set();
    for (const [index, item] of record.artifacts.entries()) {
      if (!item || typeof item !== "object") {
        failures.push(`${path}: artifacts[${index}] must be an object`);
        continue;
      }
      for (const field of ["name", "source"]) {
        if (!isNonPlaceholder(item?.[field])) {
          failures.push(`${path}: artifacts[${index}].${field} must be recorded`);
        }
      }
      if (seenArtifactNames.has(item.name)) {
        failures.push(`${path}: duplicate artifact name ${item.name}`);
      }
      seenArtifactNames.add(item.name);
      if (!isSafeRelativeRepoPath(item?.source)) {
        failures.push(`${path}: artifacts[${index}].source must be a safe repo-relative path`);
        continue;
      }
      if (!existsSync(join(root, item.source))) {
        failures.push(`${path}: artifacts[${index}].source must exist`);
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

function checkReleaseScope(path, releaseScope) {
  if (!releaseScope || typeof releaseScope !== "object" || Array.isArray(releaseScope)) {
    failures.push(`${path}: releaseScope must be an object`);
    return;
  }
  for (const name of requiredReleaseScopeDecisions) {
    const item = releaseScope[name];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failures.push(`${path}: releaseScope.${name} must be an object`);
      continue;
    }
    if (!releaseScopeStatuses.has(item.status)) {
      failures.push(`${path}: releaseScope.${name}.status must be included or excluded`);
    }
    if (!isNonPlaceholder(item.evidence)) {
      failures.push(`${path}: releaseScope.${name}.evidence must be recorded`);
    } else if (!isSafeRelativeRepoPath(item.evidence)) {
      failures.push(`${path}: releaseScope.${name}.evidence must be a safe repo-relative path`);
    } else if (!existsSync(join(root, item.evidence))) {
      failures.push(`${path}: releaseScope.${name}.evidence must exist`);
    } else if (!trackedFiles.has(item.evidence)) {
      failures.push(`${path}: releaseScope.${name}.evidence must be tracked`);
    }
  }
}

function checkReleaseRecordValidator() {
  const validRecord = createReleaseRecordSelfTestFixture();
  const validFailures = collectReleaseRecordFailures("<release-readiness-self-test-valid>", validRecord);
  if (validFailures.length > 0) {
    failures.push(`release-readiness self-test valid record failed: ${validFailures.join("; ")}`);
  }

  const unsafePathFailures = collectReleaseRecordFailures("<release-readiness-self-test-unsafe-path>", {
    ...validRecord,
    publicPackages: [
      {
        ...validRecord.publicPackages[0],
        workspacePath: "../packages/cli"
      }
    ],
    artifacts: [
      {
        ...validRecord.artifacts[0],
        source: "docs/../README.md"
      }
    ]
  });
  if (
    !unsafePathFailures.some((item) => item.includes("workspacePath must be a safe packages/* repo path")) ||
    !unsafePathFailures.some((item) => item.includes("source must be a safe repo-relative path"))
  ) {
    failures.push(`release-readiness self-test unsafe path fixture was not rejected: ${unsafePathFailures.join("; ")}`);
  }

  const mismatchFailures = collectReleaseRecordFailures("<release-readiness-self-test-package-mismatch>", {
    ...validRecord,
    releaseVersion: "9.9.9",
    publicPackages: [
      {
        ...validRecord.publicPackages[0],
        name: "not-the-cli-package"
      },
      {
        ...validRecord.publicPackages[0]
      }
    ],
    artifacts: [
      {
        ...validRecord.artifacts[0]
      },
      {
        ...validRecord.artifacts[0]
      }
    ]
  });
  if (
    !mismatchFailures.some((item) => item.includes("duplicate public package workspacePath")) ||
    !mismatchFailures.some((item) => item.includes("name must match packages/cli/package.json")) ||
    !mismatchFailures.some((item) => item.includes("version must match releaseVersion")) ||
    !mismatchFailures.some((item) => item.includes("duplicate artifact name"))
  ) {
    failures.push(`release-readiness self-test mismatch fixture was not rejected: ${mismatchFailures.join("; ")}`);
  }

  const missingScopeFailures = collectReleaseRecordFailures("<release-readiness-self-test-missing-scope>", {
    ...validRecord,
    releaseScope: {
      ...validRecord.releaseScope,
      httpTransport: {
        status: "UNDECIDED",
        evidence: "UNRECORDED"
      }
    }
  });
  if (
    !missingScopeFailures.some((item) => item.includes("releaseScope.httpTransport.status must be included or excluded")) ||
    !missingScopeFailures.some((item) => item.includes("releaseScope.httpTransport.evidence must be recorded"))
  ) {
    failures.push(`release-readiness self-test missing scope fixture was not rejected: ${missingScopeFailures.join("; ")}`);
  }

  const invalidScopeEvidenceFailures = collectReleaseRecordFailures("<release-readiness-self-test-invalid-scope-evidence>", {
    ...validRecord,
    releaseScope: {
      ...validRecord.releaseScope,
      mcpSdkDependency: {
        ...validRecord.releaseScope.mcpSdkDependency,
        evidence: "../private/sdk-decision.md"
      },
      hostApprovalUx: {
        ...validRecord.releaseScope.hostApprovalUx,
        evidence: "docs/architecture/missing-host-approval-decision.md"
      },
      httpTransport: {
        ...validRecord.releaseScope.httpTransport,
        evidence: "node_modules"
      }
    }
  });
  if (
    !invalidScopeEvidenceFailures.some((item) => item.includes("releaseScope.mcpSdkDependency.evidence must be a safe repo-relative path")) ||
    !invalidScopeEvidenceFailures.some((item) => item.includes("releaseScope.hostApprovalUx.evidence must exist")) ||
    !invalidScopeEvidenceFailures.some((item) => item.includes("releaseScope.httpTransport.evidence must be tracked"))
  ) {
    failures.push(`release-readiness self-test invalid scope evidence fixture was not rejected: ${invalidScopeEvidenceFailures.join("; ")}`);
  }
}

function createReleaseRecordSelfTestFixture() {
  const cliManifest = readJson("packages/cli/package.json");
  return {
    schemaVersion: "msp.release-readiness.v1",
    status: "blocked",
    releaseVersion: cliManifest.version,
    registryTarget: "npm",
    publishCredentialsOwner: "0disoft",
    publicPackages: [
      {
        name: cliManifest.name,
        workspacePath: "packages/cli",
        artifactName: "mcp-security-proxy-cli"
      }
    ],
    artifacts: [
      {
        name: "readme",
        source: "README.md"
      }
    ],
    releaseScope: {
      mcpSdkDependency: {
        status: "excluded",
        evidence: "docs/adr/0004-implementation-stack-direction.md"
      },
      httpTransport: {
        status: "excluded",
        evidence: "docs/architecture/07-http-transport-plan.md"
      },
      hostApprovalUx: {
        status: "excluded",
        evidence: "docs/architecture/08-host-approval-ux-plan.md"
      }
    },
    validation: Object.fromEntries(requiredValidations.map((name) => [name, "self-test recorded"])),
    rollback: {
      lastKnownGoodVersion: cliManifest.version,
      procedure: "docs/ops/rollback.md"
    }
  };
}

function collectReleaseRecordFailures(path, record) {
  const before = failures.length;
  checkReleaseRecordObject(path, record);
  return failures.splice(before);
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function isNonPlaceholder(value) {
  return typeof value === "string" && value.trim().length > 0 && value !== "UNDECIDED" && value !== "UNRECORDED";
}

function isSafeRelativeRepoPath(value) {
  if (!isNonPlaceholder(value) || value.includes("\\") || isAbsolute(value)) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
