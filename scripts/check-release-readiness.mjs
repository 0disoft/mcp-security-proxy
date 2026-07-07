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
const requiredReleaseScopeDecisions = ["mcpSdkDependency", "httpTransport", "hostApprovalUx", "externalMcpFixture"];
const releaseScopeStatuses = new Set(["included", "excluded"]);
const releaseScopeEvidencePrefixes = ["docs/adr/", "docs/architecture/", "docs/ops/"];
const releaseScopeExclusionEvidencePaths = {
  mcpSdkDependency: "docs/adr/0004-implementation-stack-direction.md",
  httpTransport: "docs/architecture/07-http-transport-plan.md",
  hostApprovalUx: "docs/architecture/08-host-approval-ux-plan.md",
  externalMcpFixture: "docs/architecture/09-external-mcp-compatibility-plan.md"
};
const localCompatibilityTarget = "local-stdio-mvp";
const compatibilityManifestPath = "fixtures/compatibility/manifest.json";
const currentHead = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
}).trim();
const historicalReachableCommit = getHistoricalReachableCommit();
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
  if (record.status === "approved" && record.releaseVersion === "0.0.0") {
    failures.push(`${path}: approved releaseVersion must not be 0.0.0`);
  }
  checkTargetCommit(path, record);
  if (!isNonPlaceholder(record.registryTarget)) {
    failures.push(`${path}: registryTarget must be recorded`);
  }
  if (!isNonPlaceholder(record.publishCredentialsOwner)) {
    failures.push(`${path}: publishCredentialsOwner must be recorded`);
  }
  checkReleaseScope(path, record.releaseScope);
  const artifactNames = new Set();
  if (Array.isArray(record.artifacts)) {
    for (const item of record.artifacts) {
      if (isNonPlaceholder(item?.name)) {
        artifactNames.add(item.name);
      }
    }
  }
  if (!Array.isArray(record.publicPackages) || record.publicPackages.length === 0) {
    failures.push(`${path}: publicPackages must contain at least one package`);
  } else {
    const seenPackageNames = new Set();
    const seenPackagePaths = new Set();
    const seenPackageArtifactNames = new Set();
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
      if (seenPackageArtifactNames.has(item.artifactName)) {
        failures.push(`${path}: duplicate public package artifactName ${item.artifactName}`);
      }
      seenPackageNames.add(item.name);
      seenPackagePaths.add(item.workspacePath);
      seenPackageArtifactNames.add(item.artifactName);
      if (isNonPlaceholder(item.artifactName) && !artifactNames.has(item.artifactName)) {
        failures.push(`${path}: publicPackages[${index}].artifactName must match an artifact name`);
      }
      if (!usesCurrentWorkspaceState(record)) {
        continue;
      }
      const packageManifestPath = `${item.workspacePath}/package.json`;
      if (!existsSync(join(root, packageManifestPath))) {
        failures.push(`${path}: publicPackages[${index}].workspacePath must contain package.json`);
        continue;
      }
      const packageManifest = readJson(packageManifestPath);
      if (packageManifest.name !== item.name) {
        failures.push(`${path}: publicPackages[${index}].name must match ${packageManifestPath}`);
      }
      if (record.status === "approved" && packageManifest.version !== record.releaseVersion) {
        failures.push(`${path}: publicPackages[${index}].version must match releaseVersion`);
      }
      if (record.status !== "approved" && packageManifest.version !== "0.0.0") {
        failures.push(`${path}: publicPackages[${index}].version must stay 0.0.0 until release record is approved`);
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
      if (!usesCurrentWorkspaceState(record)) {
        continue;
      }
      if (!existsSync(join(root, item.source))) {
        failures.push(`${path}: artifacts[${index}].source must exist`);
      } else if (!trackedFiles.has(item.source)) {
        failures.push(`${path}: artifacts[${index}].source must be tracked`);
      }
    }
  }
  for (const validation of requiredValidations) {
    if (!isNonPlaceholder(record.validation?.[validation])) {
      failures.push(`${path}: validation.${validation} must be recorded`);
    } else if (record.status === "approved") {
      checkApprovedValidationEvidence(path, validation, record.validation[validation]);
    }
  }
  if (!isNonPlaceholder(record.rollback?.lastKnownGoodVersion)) {
    failures.push(`${path}: rollback.lastKnownGoodVersion must be recorded`);
  }
  if (!isNonPlaceholder(record.rollback?.procedure)) {
    failures.push(`${path}: rollback.procedure must be recorded`);
  } else if (record.status === "approved") {
    checkApprovedRollback(path, record);
  }
}

function checkTargetCommit(path, record) {
  if (!isNonPlaceholder(record.targetCommit)) {
    if (record.status === "approved") {
      failures.push(`${path}: targetCommit must be recorded for approved releases`);
    }
    return;
  }
  if (!isFullCommitSha(record.targetCommit)) {
    failures.push(`${path}: targetCommit must be a full 40-character Git commit SHA`);
    return;
  }
  if (record.status === "approved" && !isReachableCommit(record.targetCommit)) {
    failures.push(`${path}: targetCommit must be reachable from current HEAD for approved releases`);
  }
}

function usesCurrentWorkspaceState(record) {
  return record.status !== "approved" || record.targetCommit === currentHead;
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
    } else if (!isReleaseScopeEvidencePath(item.evidence)) {
      failures.push(`${path}: releaseScope.${name}.evidence must be a docs/adr, docs/architecture, or docs/ops path`);
    } else if (item.status === "included" && item.evidence === releaseScopeExclusionEvidencePaths[name]) {
      failures.push(
        `${path}: releaseScope.${name}.evidence must not use the exclusion evidence path when status is included`
      );
    }
  }
  if (releaseScope.externalMcpFixture?.status === "included") {
    const compatibilityManifest = readJson(compatibilityManifestPath);
    if (compatibilityManifest.target === localCompatibilityTarget) {
      failures.push(
        `${path}: releaseScope.externalMcpFixture.status cannot be included while ${compatibilityManifestPath} target is ${localCompatibilityTarget}`
      );
    }
  }
}

function checkApprovedValidationEvidence(path, validation, evidence) {
  const commandPattern = validation === "check" ? /\bpnpm\s+(?:run\s+)?check\b/ : new RegExp(`\\bpnpm\\s+run\\s+${escapeRegExp(validation)}\\b`);
  if (!commandPattern.test(evidence)) {
    failures.push(`${path}: validation.${validation} must include the executed validation command`);
  }
  if (!/\bexit\s+0\b/i.test(evidence)) {
    failures.push(`${path}: validation.${validation} must include exit 0 evidence`);
  }
}

function checkApprovedRollback(path, record) {
  if (record.rollback.lastKnownGoodVersion === record.releaseVersion) {
    failures.push(`${path}: rollback.lastKnownGoodVersion must not equal releaseVersion for approved releases`);
  }
  const procedure = record.rollback.procedure;
  if (!isSafeRelativeRepoPath(procedure)) {
    failures.push(`${path}: rollback.procedure must be a safe repo-relative path for approved releases`);
  } else if (!procedure.startsWith("docs/ops/")) {
    failures.push(`${path}: rollback.procedure must be a docs/ops path for approved releases`);
  } else if (!existsSync(join(root, procedure))) {
    failures.push(`${path}: rollback.procedure must exist for approved releases`);
  } else if (!trackedFiles.has(procedure)) {
    failures.push(`${path}: rollback.procedure must be tracked for approved releases`);
  }
}

function checkReleaseRecordValidator() {
  const validRecord = createReleaseRecordSelfTestFixture();
  const validFailures = collectReleaseRecordFailures("<release-readiness-self-test-valid>", validRecord);
  if (validFailures.length > 0) {
    failures.push(`release-readiness self-test valid record failed: ${validFailures.join("; ")}`);
  }

  const validApprovedShapeRecord = createApprovedReleaseRecordSelfTestFixture();

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
    ...validApprovedShapeRecord,
    status: "approved",
    releaseVersion: "9.9.9",
    publicPackages: [
      {
        ...validApprovedShapeRecord.publicPackages[0],
        name: "not-the-cli-package"
      },
      {
        ...validApprovedShapeRecord.publicPackages[0]
      }
    ],
    artifacts: [
      {
        ...validApprovedShapeRecord.artifacts[0]
      },
      {
        ...validApprovedShapeRecord.artifacts[0]
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

  const nonApprovedFutureVersionFailures = collectReleaseRecordFailures("<release-readiness-self-test-non-approved-future-version>", {
    ...validRecord,
    status: "proposed",
    releaseVersion: "0.1.0-alpha.0",
    rollback: {
      ...validRecord.rollback,
      lastKnownGoodVersion: "0.0.0"
    }
  });
  if (nonApprovedFutureVersionFailures.length > 0) {
    failures.push(`release-readiness self-test non-approved future version failed: ${nonApprovedFutureVersionFailures.join("; ")}`);
  }

  const approvedZeroVersionFailures = collectReleaseRecordFailures("<release-readiness-self-test-approved-zero-version>", {
    ...validApprovedShapeRecord,
    status: "approved",
    releaseVersion: "0.0.0"
  });
  if (!approvedZeroVersionFailures.some((item) => item.includes("approved releaseVersion must not be 0.0.0"))) {
    failures.push(`release-readiness self-test approved zero version was not rejected: ${approvedZeroVersionFailures.join("; ")}`);
  }

  const approvedMissingTargetCommitFailures = collectReleaseRecordFailures("<release-readiness-self-test-approved-missing-target-commit>", {
    ...validApprovedShapeRecord,
    targetCommit: "UNRECORDED"
  });
  if (!approvedMissingTargetCommitFailures.some((item) => item.includes("targetCommit must be recorded for approved releases"))) {
    failures.push(
      `release-readiness self-test approved missing targetCommit was not rejected: ${approvedMissingTargetCommitFailures.join("; ")}`
    );
  }

  const invalidTargetCommitFailures = collectReleaseRecordFailures("<release-readiness-self-test-invalid-target-commit>", {
    ...validRecord,
    targetCommit: "main"
  });
  if (!invalidTargetCommitFailures.some((item) => item.includes("targetCommit must be a full 40-character Git commit SHA"))) {
    failures.push(`release-readiness self-test invalid targetCommit was not rejected: ${invalidTargetCommitFailures.join("; ")}`);
  }

  const approvedUnreachableTargetCommitFailures = collectReleaseRecordFailures("<release-readiness-self-test-approved-unreachable-target-commit>", {
    ...validApprovedShapeRecord,
    targetCommit: "0000000000000000000000000000000000000000"
  });
  if (!approvedUnreachableTargetCommitFailures.some((item) => item.includes("targetCommit must be reachable from current HEAD"))) {
    failures.push(
      `release-readiness self-test approved unreachable targetCommit was not rejected: ${approvedUnreachableTargetCommitFailures.join("; ")}`
    );
  }

  if (historicalReachableCommit !== currentHead) {
    const historicalApprovedFailures = collectReleaseRecordFailures("<release-readiness-self-test-historical-approved-record>", {
      ...validApprovedShapeRecord,
      targetCommit: historicalReachableCommit,
      publicPackages: [
        {
          ...validApprovedShapeRecord.publicPackages[0],
          name: "historical-package-name",
          artifactName: "historical-artifact"
        }
      ],
      artifacts: [
        {
          name: "historical-artifact",
          source: "docs/ops/historical-release-artifact.md"
        }
      ]
    });
    if (historicalApprovedFailures.length > 0) {
      failures.push(`release-readiness self-test historical approved record failed: ${historicalApprovedFailures.join("; ")}`);
    }
  }

  const untrackedArtifactFailures = collectReleaseRecordFailures("<release-readiness-self-test-untracked-artifact>", {
    ...validRecord,
    artifacts: [
      {
        name: "release-records-directory",
        source: "docs/ops/release-records"
      }
    ]
  });
  if (!untrackedArtifactFailures.some((item) => item.includes("artifacts[0].source must be tracked"))) {
    failures.push(`release-readiness self-test untracked artifact source was not rejected: ${untrackedArtifactFailures.join("; ")}`);
  }

  const duplicatePackageArtifactNameFailures = collectReleaseRecordFailures("<release-readiness-self-test-duplicate-package-artifact-name>", {
    ...validRecord,
    publicPackages: [
      {
        ...validRecord.publicPackages[0]
      },
      {
        ...validRecord.publicPackages[0],
        name: "another-cli-package",
        workspacePath: "packages/core"
      }
    ]
  });
  if (!duplicatePackageArtifactNameFailures.some((item) => item.includes("duplicate public package artifactName"))) {
    failures.push(`release-readiness self-test duplicate package artifact name was not rejected: ${duplicatePackageArtifactNameFailures.join("; ")}`);
  }

  const missingPackageArtifactFailures = collectReleaseRecordFailures("<release-readiness-self-test-missing-package-artifact>", {
    ...validRecord,
    publicPackages: [
      {
        ...validRecord.publicPackages[0],
        artifactName: "missing-package-artifact"
      }
    ]
  });
  if (!missingPackageArtifactFailures.some((item) => item.includes("publicPackages[0].artifactName must match an artifact name"))) {
    failures.push(`release-readiness self-test missing package artifact was not rejected: ${missingPackageArtifactFailures.join("; ")}`);
  }

  const missingValidationFailures = collectReleaseRecordFailures("<release-readiness-self-test-missing-validation>", {
    ...validRecord,
    validation: {
      ...validRecord.validation,
      docs: "UNRECORDED"
    },
    rollback: {
      lastKnownGoodVersion: "UNDECIDED",
      procedure: "UNRECORDED"
    }
  });
  if (
    !missingValidationFailures.some((item) => item.includes("validation.docs must be recorded")) ||
    !missingValidationFailures.some((item) => item.includes("rollback.lastKnownGoodVersion must be recorded")) ||
    !missingValidationFailures.some((item) => item.includes("rollback.procedure must be recorded"))
  ) {
    failures.push(
      `release-readiness self-test missing validation and rollback evidence was not rejected: ${missingValidationFailures.join("; ")}`
    );
  }

  const approvedWeakValidationFailures = collectReleaseRecordFailures("<release-readiness-self-test-approved-weak-validation>", {
    ...validApprovedShapeRecord,
    validation: {
      ...validApprovedShapeRecord.validation,
      docs: "docs passed",
      check: "pnpm check passed"
    }
  });
  if (
    !approvedWeakValidationFailures.some((item) => item.includes("validation.docs must include the executed validation command")) ||
    !approvedWeakValidationFailures.some((item) => item.includes("validation.docs must include exit 0 evidence")) ||
    !approvedWeakValidationFailures.some((item) => item.includes("validation.check must include exit 0 evidence"))
  ) {
    failures.push(
      `release-readiness self-test approved weak validation evidence was not rejected: ${approvedWeakValidationFailures.join("; ")}`
    );
  }

  const approvedWeakRollbackFailures = collectReleaseRecordFailures("<release-readiness-self-test-approved-weak-rollback>", {
    ...validApprovedShapeRecord,
    rollback: {
      lastKnownGoodVersion: validApprovedShapeRecord.releaseVersion,
      procedure: "../rollback.md"
    }
  });
  if (
    !approvedWeakRollbackFailures.some((item) =>
      item.includes("rollback.lastKnownGoodVersion must not equal releaseVersion")
    ) ||
    !approvedWeakRollbackFailures.some((item) =>
      item.includes("rollback.procedure must be a safe repo-relative path for approved releases")
    )
  ) {
    failures.push(
      `release-readiness self-test approved weak rollback evidence was not rejected: ${approvedWeakRollbackFailures.join("; ")}`
    );
  }

  const approvedUntrackedRollbackFailures = collectReleaseRecordFailures("<release-readiness-self-test-approved-untracked-rollback>", {
    ...validApprovedShapeRecord,
    rollback: {
      lastKnownGoodVersion: "0.0.0",
      procedure: "docs/ops/release-records"
    }
  });
  if (!approvedUntrackedRollbackFailures.some((item) => item.includes("rollback.procedure must be tracked"))) {
    failures.push(
      `release-readiness self-test approved untracked rollback procedure was not rejected: ${approvedUntrackedRollbackFailures.join("; ")}`
    );
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

  const { externalMcpFixture, ...releaseScopeWithoutExternalMcpFixture } = validRecord.releaseScope;
  const omittedScopeFailures = collectReleaseRecordFailures("<release-readiness-self-test-omitted-scope>", {
    ...validRecord,
    releaseScope: releaseScopeWithoutExternalMcpFixture
  });
  if (!omittedScopeFailures.some((item) => item.includes("releaseScope.externalMcpFixture must be an object"))) {
    failures.push(`release-readiness self-test omitted scope fixture was not rejected: ${omittedScopeFailures.join("; ")}`);
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

  const wrongScopeEvidenceLocationFailures = collectReleaseRecordFailures("<release-readiness-self-test-wrong-scope-evidence-location>", {
    ...validRecord,
    releaseScope: {
      ...validRecord.releaseScope,
      mcpSdkDependency: {
        ...validRecord.releaseScope.mcpSdkDependency,
        evidence: "README.md"
      }
    }
  });
  if (
    !wrongScopeEvidenceLocationFailures.some((item) =>
      item.includes("releaseScope.mcpSdkDependency.evidence must be a docs/adr, docs/architecture, or docs/ops path")
    )
  ) {
    failures.push(
      `release-readiness self-test wrong scope evidence location fixture was not rejected: ${wrongScopeEvidenceLocationFailures.join("; ")}`
    );
  }

  const includedScopeExclusionEvidenceFailures = collectReleaseRecordFailures("<release-readiness-self-test-included-scope-exclusion-evidence>", {
    ...validRecord,
    releaseScope: {
      ...validRecord.releaseScope,
      mcpSdkDependency: {
        ...validRecord.releaseScope.mcpSdkDependency,
        status: "included"
      },
      httpTransport: {
        ...validRecord.releaseScope.httpTransport,
        status: "included"
      },
      hostApprovalUx: {
        ...validRecord.releaseScope.hostApprovalUx,
        status: "included"
      }
    }
  });
  if (
    !includedScopeExclusionEvidenceFailures.some((item) =>
      item.includes("releaseScope.mcpSdkDependency.evidence must not use the exclusion evidence path")
    ) ||
    !includedScopeExclusionEvidenceFailures.some((item) =>
      item.includes("releaseScope.httpTransport.evidence must not use the exclusion evidence path")
    ) ||
    !includedScopeExclusionEvidenceFailures.some((item) =>
      item.includes("releaseScope.hostApprovalUx.evidence must not use the exclusion evidence path")
    )
  ) {
    failures.push(
      `release-readiness self-test included scope exclusion evidence was not rejected: ${includedScopeExclusionEvidenceFailures.join("; ")}`
    );
  }

  const includedExternalMcpFixtureFailures = collectReleaseRecordFailures("<release-readiness-self-test-external-mcp-included>", {
    ...validRecord,
    releaseScope: {
      ...validRecord.releaseScope,
      externalMcpFixture: {
        ...validRecord.releaseScope.externalMcpFixture,
        status: "included"
      }
    }
  });
  if (
    !includedExternalMcpFixtureFailures.some((item) =>
      item.includes(`releaseScope.externalMcpFixture.status cannot be included while ${compatibilityManifestPath} target is ${localCompatibilityTarget}`)
    )
  ) {
    failures.push(
      `release-readiness self-test included external MCP fixture was not rejected: ${includedExternalMcpFixtureFailures.join("; ")}`
    );
  }
}

function createReleaseRecordSelfTestFixture() {
  const cliManifest = readJson("packages/cli/package.json");
  return {
    schemaVersion: "msp.release-readiness.v1",
    status: "blocked",
    releaseVersion: cliManifest.version,
    targetCommit: "UNRECORDED",
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
        name: "mcp-security-proxy-cli",
        source: "packages/cli/package.json"
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
      },
      externalMcpFixture: {
        status: "excluded",
        evidence: "docs/architecture/09-external-mcp-compatibility-plan.md"
      }
    },
    validation: Object.fromEntries(requiredValidations.map((name) => [name, "self-test recorded"])),
    rollback: {
      lastKnownGoodVersion: cliManifest.version,
      procedure: "docs/ops/rollback.md"
    }
  };
}

function createApprovedReleaseRecordSelfTestFixture() {
  return {
    ...createReleaseRecordSelfTestFixture(),
    status: "approved",
    releaseVersion: "9.9.9",
    targetCommit: currentHead,
    validation: Object.fromEntries(requiredValidations.map((name) => [name, createApprovedValidationEvidence(name)]))
  };
}

function createApprovedValidationEvidence(name) {
  const command = name === "check" ? "pnpm check" : `pnpm run ${name}`;
  return `${command} exit 0`;
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

function isReleaseScopeEvidencePath(value) {
  return releaseScopeEvidencePrefixes.some((prefix) => value.startsWith(prefix));
}

function isFullCommitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}

function isReachableCommit(value) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", value, currentHead], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}

function getHistoricalReachableCommit() {
  try {
    return execFileSync("git", ["rev-list", "--max-count=1", "--skip=1", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || currentHead;
  } catch {
    return currentHead;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
