import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildPublicationReceipt,
  parsePublicationReceiptRequest,
  resolvePublicationReceiptInput,
  validateWorkflowRun
} from "./generate-publication-receipt.mjs";
import { createPublicationRecordSchemaValidator } from "./lib/publication-record-schema.mjs";
import { validatePublicationRecord } from "./lib/publication-record-validation.mjs";

const root = process.cwd();
const publicationsDir = join(root, "docs", "ops", "publications");
const bootstrapPlan = readJson("docs/ops/npm-bootstrap-plan.json");
const failures = [];
const publicationRecords = [];
const validatePublicationRecordShape = createPublicationRecordSchemaValidator(root);

if (!existsSync(publicationsDir)) {
  failures.push("docs/ops/publications is missing");
} else {
  for (const name of readdirSync(publicationsDir)
    .filter((item) => item.endsWith(".publication.json"))
    .sort()) {
    const path = `docs/ops/publications/${name}`;
    const record = readJson(path);
    publicationRecords.push({ path, record });
    failures.push(
      ...validatePublicationRecord({
        root,
        path,
        record,
        bootstrapPlan,
        validateShape: validatePublicationRecordShape
      })
    );
  }
}

if (publicationRecords.length === 0) {
  failures.push("docs/ops/publications must contain at least one publication record");
} else {
  checkValidator(publicationRecords[0]);
  const v2Sample = publicationRecords.find(({ record }) => record?.schemaVersion === "msp.publication-record.v2");
  if (!v2Sample) {
    failures.push("docs/ops/publications must contain at least one msp.publication-record.v2 receipt");
  } else {
    checkV2Validator(v2Sample);
  }
  const alpha4 = publicationRecords.find(({ record }) => record?.releaseVersion === "0.2.0-alpha.4");
  if (alpha4?.record?.schemaVersion !== "msp.publication-record.v2") {
    failures.push("the 0.2.0-alpha.4 publication receipt must retain its GitHub Release evidence as v2");
  }
}
checkGeneratorContract();

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

function checkValidator(sample) {
  const missingPackage = structuredClone(sample.record);
  missingPackage.packages = missingPackage.packages.slice(1);
  const missingFailures = validatePublicationRecord({
    root,
    path: sample.path,
    record: missingPackage,
    bootstrapPlan,
    validateShape: validatePublicationRecordShape
  });
  if (!missingFailures.some((item) => item.includes("packages must exactly match"))) {
    failures.push("publication record self-test did not reject a missing package");
  }

  const badRunUrl = structuredClone(sample.record);
  badRunUrl.releaseRun.url = "https://example.invalid/run";
  const runFailures = validatePublicationRecord({
    root,
    path: sample.path,
    record: badRunUrl,
    bootstrapPlan,
    validateShape: validatePublicationRecordShape
  });
  if (!runFailures.some((item) => item.includes("releaseRun.url must match"))) {
    failures.push("publication record self-test did not reject a mismatched run URL");
  }

  const badProvenance = structuredClone(sample.record);
  badProvenance.packages[0].provenance.verifiedByRunId += 1;
  const provenanceFailures = validatePublicationRecord({
    root,
    path: sample.path,
    record: badProvenance,
    bootstrapPlan,
    validateShape: validatePublicationRecordShape
  });
  if (!provenanceFailures.some((item) => item.includes("verifiedByRunId must match"))) {
    failures.push("publication record self-test did not reject mismatched provenance evidence");
  }

  const unknownField = structuredClone(sample.record);
  unknownField.untrackedEvidence = true;
  if (validatePublicationRecordShape(unknownField).valid) {
    failures.push("publication record JSON Schema self-test accepted an unknown top-level field");
  }
}

function checkV2Validator(sample) {
  for (const mutation of [
    {
      label: "an invalid GitHub Release id",
      expectedMessage: "githubRelease.id must be a positive integer",
      apply: (record) => {
        record.githubRelease.id = 0;
      }
    },
    {
      label: "a mismatched GitHub Release tag commit",
      expectedMessage: "githubRelease.tagCommit must equal releaseCommit",
      apply: (record) => {
        record.githubRelease.tagCommit = "f".repeat(40);
      }
    },
    {
      label: "a draft GitHub Release",
      expectedMessage: "githubRelease.draft must be false",
      apply: (record) => {
        record.githubRelease.draft = true;
      }
    },
    {
      label: "a mismatched GitHub Release channel",
      expectedMessage: "githubRelease.prerelease must match",
      apply: (record) => {
        record.githubRelease.prerelease = !record.githubRelease.prerelease;
      }
    },
    {
      label: "a mismatched GitHub Release URL",
      expectedMessage: "githubRelease.url must match",
      apply: (record) => {
        record.githubRelease.url = "https://example.invalid/release";
      }
    },
    {
      label: "a GitHub Release observation before publication",
      expectedMessage: "githubRelease.observedAt must not precede githubRelease.publishedAt",
      apply: (record) => {
        record.githubRelease.observedAt = "2026-01-01T00:00:00Z";
      }
    }
  ]) {
    const changed = structuredClone(sample.record);
    mutation.apply(changed);
    const issues = validatePublicationRecord({
      root,
      path: sample.path,
      record: changed,
      bootstrapPlan,
      validateShape: validatePublicationRecordShape
    });
    if (!issues.some((item) => item.includes(mutation.expectedMessage))) {
      failures.push(`publication record self-test did not reject ${mutation.label}`);
    }
  }
}

function checkGeneratorContract() {
  const request = parsePublicationReceiptRequest(
    "Registry Smoke receipt: version=0.2.0-alpha.2; release-run=29487801259"
  );
  if (request.version !== "0.2.0-alpha.2" || request.releaseRunId !== 29487801259) {
    failures.push("publication receipt generator self-test did not parse the structured smoke run name");
  }
  const resolved = resolvePublicationReceiptInput([], {
    MSP_PUBLICATION_RECEIPT_REQUEST: "Registry Smoke receipt: version=0.2.0-alpha.2; release-run=29487801259",
    MSP_REGISTRY_SMOKE_RUN_ID: "29488068953",
    MSP_PUBLICATION_RECEIPT_OUTPUT_DIR: "publication-receipt"
  });
  if (
    resolved.version !== "0.2.0-alpha.2" ||
    resolved.releaseRunId !== 29487801259 ||
    resolved.registrySmokeRunId !== 29488068953 ||
    resolved.outputPath.replaceAll("\\", "/") !== "publication-receipt/0.2.0-alpha.2.publication.json"
  ) {
    failures.push("publication receipt generator self-test did not resolve the workflow event inputs");
  }
  assertGeneratorRejects(
    () => parsePublicationReceiptRequest("Registry Smoke receipt: version=latest; release-run=1"),
    "run name",
    "a dist-tag receipt request"
  );

  const run = {
    id: 42,
    repository: { full_name: "0disoft/mcp-security-proxy" },
    path: ".github/workflows/release.yml",
    event: "push",
    head_branch: "v0.2.0-alpha.2",
    head_sha: "a".repeat(40),
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/0disoft/mcp-security-proxy/actions/runs/42",
    updated_at: "2026-07-16T09:40:35Z"
  };
  validateWorkflowRun("self-test release run", run, {
    id: 42,
    workflow: "release.yml",
    event: "push",
    headBranch: "v0.2.0-alpha.2"
  });
  assertGeneratorRejects(
    () =>
      validateWorkflowRun(
        "self-test release run",
        { ...run, conclusion: "failure" },
        {
          id: 42,
          workflow: "release.yml",
          event: "push",
          headBranch: "v0.2.0-alpha.2"
        }
      ),
    "completed successfully",
    "a failed workflow run"
  );

  const receiptInput = {
    version: "0.2.0-alpha.2",
    releaseRecordPath: "docs/ops/release-records/0.2.0-alpha.2.approved.release.json",
    releaseCommit: "a".repeat(40),
    githubRelease: {
      id: 44,
      tag_name: "v0.2.0-alpha.2",
      draft: false,
      prerelease: true,
      html_url: "https://github.com/0disoft/mcp-security-proxy/releases/tag/v0.2.0-alpha.2",
      published_at: "2026-07-16T09:43:00Z"
    },
    releaseRun: run,
    registrySmokeRun: {
      ...run,
      id: 43,
      path: ".github/workflows/registry-smoke.yml",
      event: "workflow_dispatch",
      html_url: "https://github.com/0disoft/mcp-security-proxy/actions/runs/43"
    },
    registryPackages: [
      {
        name: "@0disoft/mcp-security-proxy-contracts",
        integrity: "sha512-test",
        shasum: "b".repeat(40),
        publishedAt: "2026-07-16T09:40:02Z",
        distTags: { latest: "0.2.0-alpha.2", bootstrap: "0.0.0-bootstrap.0" }
      }
    ],
    expectedBootstrapVersion: "0.0.0-bootstrap.0",
    recordedAt: "2026-07-16T09:44:51Z"
  };
  const generated = buildPublicationReceipt(receiptInput);
  if (
    generated.schemaVersion !== "msp.publication-record.v2" ||
    generated.githubRelease?.tagCommit !== receiptInput.releaseCommit
  ) {
    failures.push("publication receipt generator self-test did not emit linked GitHub Release v2 evidence");
  }
  if (generated.packages[0]?.provenance?.verifiedByRunId !== 43) {
    failures.push("publication receipt generator self-test did not link provenance verification to smoke run");
  }
  assertGeneratorRejects(
    () =>
      buildPublicationReceipt({
        ...receiptInput,
        registryPackages: [
          ...receiptInput.registryPackages,
          {
            ...receiptInput.registryPackages[0],
            name: "@0disoft/mcp-security-proxy-core",
            distTags: { latest: "0.2.0-alpha.1", bootstrap: "0.0.0-bootstrap.0" }
          }
        ]
      }),
    "consistent latest/bootstrap",
    "inconsistent package dist-tags"
  );
  assertGeneratorRejects(
    () =>
      buildPublicationReceipt({
        ...receiptInput,
        githubRelease: { ...receiptInput.githubRelease, draft: true }
      }),
    "published, not draft",
    "a draft GitHub Release"
  );
  assertGeneratorRejects(
    () =>
      buildPublicationReceipt({
        ...receiptInput,
        githubRelease: { ...receiptInput.githubRelease, prerelease: false }
      }),
    "prerelease state",
    "a mismatched GitHub Release channel"
  );
}

function assertGeneratorRejects(operation, expectedMessage, label) {
  try {
    operation();
    failures.push(`publication receipt generator self-test accepted ${label}`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(expectedMessage)) {
      failures.push(`publication receipt generator self-test rejected ${label} for an unexpected reason`);
    }
  }
}

function checkDocumentationContract() {
  const manifest = readJson("package.json");
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const releaseDoc = readFileSync(join(root, "docs", "ops", "release.md"), "utf8");
  const ciDoc = readFileSync(join(root, "docs", "ops", "ci.md"), "utf8");
  const publicationReadme = readFileSync(join(root, "docs", "ops", "publications", "README.md"), "utf8");
  const importer = readFileSync(join(root, "scripts", "import-publication-receipt.mjs"), "utf8");
  const normalizedPublicationReadme = publicationReadme.replace(/\s+/gu, " ");
  if (!manifest.scripts?.["release-readiness"]?.includes("scripts/import-publication-receipt.test.mjs")) {
    failures.push("package.json release-readiness must run the publication receipt import regression tests");
  }
  if (!readme.includes("published to npm with provenance")) {
    failures.push("README.md must describe the completed npm provenance publication");
  }
  if (!releaseDoc.includes("docs/ops/publications/*.publication.json")) {
    failures.push("docs/ops/release.md must document publication records");
  }
  if (!ciDoc.includes("publication receipt")) {
    failures.push("docs/ops/ci.md must document publication receipt validation");
  }
  for (const phrase of [
    "node scripts/generate-publication-receipt.mjs",
    "node scripts/import-publication-receipt.mjs",
    "manual-only import command",
    "never stages, commits, pushes, or performs network requests",
    "The workflow deliberately has no repository write permission",
    "A generated artifact is evidence ready for review"
  ]) {
    if (!normalizedPublicationReadme.includes(phrase)) {
      failures.push(`docs/ops/publications/README.md: missing receipt automation phrase: ${phrase}`);
    }
  }
  for (const phrase of [
    "msp.publication-record.v2",
    "GitHub Release ID",
    "tag commit",
    "draft and prerelease state",
    "publication-record.v1.schema.json",
    "publication-record.v2.schema.json",
    "Schema validation and semantic validation"
  ]) {
    if (!normalizedPublicationReadme.includes(phrase)) {
      failures.push(`docs/ops/publications/README.md: missing v2 evidence phrase: ${phrase}`);
    }
  }
  for (const phrase of [
    "validatePublicationRecord({ root, path: destination, record })",
    "publication receipt releaseVersion must match --version",
    "already exists; publication receipts are immutable",
    "linkSync(stagingPath, destinationPath)",
    "sha256"
  ]) {
    if (!importer.includes(phrase)) {
      failures.push(`scripts/import-publication-receipt.mjs: missing safe import phrase: ${phrase}`);
    }
  }
  if (/\b(?:git|fetch)\b/iu.test(importer)) {
    failures.push("scripts/import-publication-receipt.mjs must not perform Git or network operations");
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}
