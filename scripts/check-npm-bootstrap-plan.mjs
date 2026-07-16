import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

const root = process.cwd();
const planPath = "docs/ops/npm-bootstrap-plan.json";
const runbookPath = "docs/ops/npm-bootstrap.md";
const releaseWorkflowPath = ".github/workflows/release.yml";
const expectedPackages = [
  ["@0disoft/mcp-security-proxy-contracts", "packages/contracts"],
  ["@0disoft/mcp-security-proxy-core", "packages/core"],
  ["@0disoft/mcp-security-proxy-mcp-adapter", "packages/mcp-adapter"],
  ["@0disoft/mcp-security-proxy-runtime", "packages/proxy-runtime"],
  ["@0disoft/mcp-security-proxy-cli", "packages/cli"]
];
const expectedRepositoryUrl = "https://github.com/0disoft/mcp-security-proxy.git";
const expectedRegistry = "https://registry.npmjs.org";
const registryCheckRequested = process.argv.includes("--registry-check");
const failures = [];

if (!existsSync(join(root, planPath))) {
  failures.push(`${planPath}: bootstrap plan is missing`);
} else {
  const plan = readJson(planPath);
  failures.push(...collectPlanFailures(plan, planPath));
  checkWorkspaceManifests(plan);
  checkRunbookAndWorkflow();
  checkPlanValidator();
  if (registryCheckRequested && failures.length === 0) {
    checkRegistryState(plan);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

const plan = readJson(planPath);
console.log(`npm bootstrap plan ok (${plan.status}${registryCheckRequested ? ", registry checked" : ""})`);

function collectPlanFailures(plan, label) {
  const planFailures = [];
  const assert = (condition, message) => {
    if (!condition) {
      planFailures.push(`${label}: ${message}`);
    }
  };

  assert(plan?.schemaVersion === "msp.npm-bootstrap.v1", "schemaVersion must be msp.npm-bootstrap.v1");
  assert(["blocked", "approved", "completed"].includes(plan?.status), "status must be blocked, approved, or completed");
  assert(plan?.bootstrapVersion === "0.0.0-bootstrap.0", "bootstrapVersion must be 0.0.0-bootstrap.0");
  assert(plan?.distTag === "bootstrap", "distTag must be bootstrap for the bootstrap marker");
  assert(plan?.registry === expectedRegistry, `registry must be ${expectedRegistry}`);
  assert(plan?.registryOwner === "0disoft", "registryOwner must be 0disoft");
  assert(
    plan?.artifactDirectory === ".tmp/npm-bootstrap",
    "artifactDirectory must stay under the ignored bootstrap path"
  );
  assert(plan?.credentialMode === "interactive-owner-session", "credentialMode must be interactive-owner-session");
  assert(plan?.credentialPersistence === "none", "credentialPersistence must be none");
  assert(
    JSON.stringify((plan?.packages ?? []).map((item) => [item?.name, item?.workspacePath])) ===
      JSON.stringify(expectedPackages),
    "packages must match the five release-recorded package names and workspace paths in publish order"
  );
  assert(
    plan?.trustedPublisher?.repository === "0disoft/mcp-security-proxy",
    "trustedPublisher.repository must match GitHub"
  );
  assert(
    plan?.trustedPublisher?.workflow === releaseWorkflowPath,
    `trustedPublisher.workflow must be ${releaseWorkflowPath}`
  );
  assert(plan?.trustedPublisher?.environment === "npm", "trustedPublisher.environment must be npm");
  assert(
    plan?.postPublish?.configureTrustedPublisher === "required",
    "Trusted Publisher configuration must be required"
  );
  assert(
    plan?.postPublish?.replaceInitialLatestTag === "required-by-first-oidc-release",
    "initial latest dist-tag replacement must be required by the first OIDC release"
  );
  assert(plan?.postPublish?.removeBootstrapCredential === "required", "bootstrap credential removal must be required");
  assert(plan?.postPublish?.verifyRegistryVersions === "required", "registry version verification must be required");
  assert(
    plan?.postPublish?.bootstrapVersionPolicy === "deprecate-after-first-oidc-release",
    "bootstrap version must be deprecated after the first OIDC release"
  );
  assert(Array.isArray(plan?.blockers), "blockers must be an array");
  if (plan?.status === "completed") {
    assert(plan.blockers.length === 0, "completed plan blockers must be empty");
  } else {
    assert(plan?.blockers?.length > 0, "incomplete plan blockers must record the remaining manual gates");
  }

  if (plan?.status === "approved" || plan?.status === "completed") {
    assert(plan?.approval?.approvedBy === plan.registryOwner, "approvedBy must match registryOwner after approval");
    assert(
      isFullCommitSha(plan?.approval?.sourceCommit),
      "approval.sourceCommit must be a full Git commit SHA after approval"
    );
  } else {
    assert(plan?.approval?.approvedBy === "UNRECORDED", "blocked plan approvedBy must stay UNRECORDED");
    assert(plan?.approval?.sourceCommit === "UNRECORDED", "blocked plan sourceCommit must stay UNRECORDED");
  }
  if (plan?.status === "completed") {
    assert(
      plan?.completion?.completedBy === plan.registryOwner,
      "completedBy must match registryOwner after completion"
    );
    assert(isFullCommitSha(plan?.completion?.sourceCommit), "completion.sourceCommit must be a full Git commit SHA");
    assert(
      Array.isArray(plan?.completion?.artifactSourceCommits) &&
        plan.completion.artifactSourceCommits.length > 0 &&
        plan.completion.artifactSourceCommits.every(isFullCommitSha),
      "completion.artifactSourceCommits must contain full Git commit SHAs"
    );
    assert(
      isRecorded(plan?.completion?.registryEvidence),
      "completion.registryEvidence must record the registry verification"
    );
    assert(plan?.completion?.trustedPublisherConfigured === true, "Trusted Publisher completion evidence must be true");
    assert(plan?.completion?.bootstrapCredentialRemoved === true, "bootstrap credential removal evidence must be true");
  } else {
    assert(plan?.completion?.completedBy === "UNRECORDED", "incomplete plan completedBy must stay UNRECORDED");
    assert(
      plan?.completion?.sourceCommit === "UNRECORDED",
      "incomplete plan completion sourceCommit must stay UNRECORDED"
    );
    assert(
      plan?.completion?.artifactSourceCommits === undefined,
      "incomplete plan artifactSourceCommits must stay absent"
    );
    assert(
      plan?.completion?.registryEvidence === "UNRECORDED",
      "incomplete plan registryEvidence must stay UNRECORDED"
    );
    assert(
      plan?.completion?.trustedPublisherConfigured === false,
      "incomplete plan must not claim Trusted Publisher configuration"
    );
    assert(plan?.completion?.bootstrapCredentialRemoved === false, "incomplete plan must not claim credential removal");
  }
  return planFailures;
}

function checkWorkspaceManifests(plan) {
  const productReleaseVersion = findApprovedProductReleaseVersion(plan);
  for (const [name, workspacePath] of expectedPackages) {
    const manifestPath = `${workspacePath}/package.json`;
    if (!existsSync(join(root, manifestPath))) {
      failures.push(`${manifestPath}: package manifest is missing`);
      continue;
    }
    const manifest = readJson(manifestPath);
    if (manifest.name !== name) {
      failures.push(`${manifestPath}: name must be ${name}`);
    }
    const isBootstrapSourcePosture = manifest.private === true && manifest.version === "0.0.0";
    const isApprovedProductReleasePosture =
      productReleaseVersion !== undefined && manifest.private !== true && manifest.version === productReleaseVersion;
    if (!isBootstrapSourcePosture && !isApprovedProductReleasePosture) {
      failures.push(
        `${manifestPath}: source manifest must stay private at 0.0.0 or match the reachable approved product release`
      );
    }
    if (manifest.repository?.url !== expectedRepositoryUrl) {
      failures.push(`${manifestPath}: repository.url must match the Trusted Publisher repository`);
    }
    if (manifest.publishConfig?.access !== "public" || manifest.publishConfig?.registry !== plan.registry) {
      failures.push(`${manifestPath}: publishConfig must target public npmjs.org publication`);
    }
    if (JSON.stringify(manifest).match(/(?:NODE_AUTH_TOKEN|NPM_TOKEN|npm_[A-Za-z0-9]{20,})/)) {
      failures.push(`${manifestPath}: package metadata must not contain registry credentials`);
    }
  }
}

function findApprovedProductReleaseVersion(plan) {
  const releaseRecordsDirectory = join(root, "docs", "ops", "release-records");
  if (!existsSync(releaseRecordsDirectory)) {
    return undefined;
  }
  const expectedNames = [...plan.packages].map((item) => item.name).sort((left, right) => left.localeCompare(right));
  const matches = readdirSync(releaseRecordsDirectory)
    .filter((name) => name.endsWith(".release.json"))
    .map((name) => readJson(`docs/ops/release-records/${name}`))
    .filter((record) => {
      if (record?.status !== "approved" || !isFullCommitSha(record?.targetCommit)) {
        return false;
      }
      const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", record.targetCommit, "HEAD"], {
        cwd: root,
        stdio: "ignore",
        windowsHide: true
      });
      if (ancestry.status !== 0) {
        return false;
      }
      const names = (record.publicPackages ?? [])
        .map((item) => item?.name)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
      return JSON.stringify(names) === JSON.stringify(expectedNames);
    });
  const selected = selectLatestLinearRelease(matches);
  if (!selected || typeof selected.releaseVersion !== "string") {
    return undefined;
  }
  return selected.releaseVersion;
}

function selectLatestLinearRelease(records) {
  let selected;
  for (const record of records) {
    if (!selected) {
      selected = record;
      continue;
    }
    if (selected.targetCommit === record.targetCommit) {
      if (selected.releaseVersion !== record.releaseVersion) {
        failures.push(
          `approved product releases conflict at target ${record.targetCommit}: ${selected.releaseVersion} and ${record.releaseVersion}`
        );
        return undefined;
      }
      continue;
    }
    if (isAncestorCommit(selected.targetCommit, record.targetCommit)) {
      selected = record;
      continue;
    }
    if (!isAncestorCommit(record.targetCommit, selected.targetCommit)) {
      failures.push(
        `approved product release targets ${selected.targetCommit} and ${record.targetCommit} are not on one linear history`
      );
      return undefined;
    }
  }
  return selected;
}

function isAncestorCommit(ancestor, descendant) {
  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true
  });
  return ancestry.status === 0;
}

function checkRunbookAndWorkflow() {
  if (!existsSync(join(root, runbookPath))) {
    failures.push(`${runbookPath}: bootstrap runbook is missing`);
  } else {
    const runbook = readFileSync(join(root, runbookPath), "utf8");
    for (const phrase of [
      "0.0.0-bootstrap.0",
      "--tag bootstrap",
      "node scripts/check-npm-bootstrap-plan.mjs --registry-check",
      "node scripts/prepare-npm-bootstrap-artifacts.mjs --write",
      "npm dist-tag ls",
      "npm logout",
      "Do not create a Git tag for the bootstrap version"
    ]) {
      if (!runbook.includes(phrase)) {
        failures.push(`${runbookPath}: missing required bootstrap guidance: ${phrase}`);
      }
    }
    if (/--otp(?:=|\s)|NODE_AUTH_TOKEN|NPM_TOKEN/.test(runbook)) {
      failures.push(`${runbookPath}: credentials and OTP values must not be passed in copyable commands`);
    }
  }

  const workflow = readFileSync(join(root, releaseWorkflowPath), "utf8");
  if (!workflow.includes("id-token: write") || !workflow.includes("environment: npm")) {
    failures.push(`${releaseWorkflowPath}: normal release must remain an npm OIDC workflow`);
  }
  if (/NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./.test(workflow)) {
    failures.push(`${releaseWorkflowPath}: normal release workflow must not gain a bootstrap token path`);
  }
}

function checkRegistryState(plan) {
  const identity = runNpm(["whoami", "--registry", plan.registry]);
  if (identity.status !== 0) {
    failures.push("npm registry check requires an authenticated interactive owner session");
    return;
  }
  if (identity.stdout.trim() !== plan.registryOwner) {
    failures.push(`npm authenticated owner must be ${plan.registryOwner}`);
    return;
  }

  for (const item of plan.packages) {
    const result = runNpm(["view", item.name, "name", "--json", "--registry", plan.registry]);
    if (result.status === 0) {
      failures.push(`${item.name}: package already exists; bootstrap publication must stop`);
      continue;
    }
    if (!`${result.stdout}\n${result.stderr}`.includes("E404")) {
      failures.push(`${item.name}: registry absence could not be confirmed as E404`);
    }
  }
}

function checkPlanValidator() {
  const plan = readJson(planPath);
  const validFailures = collectPlanFailures(plan, "<npm-bootstrap-self-test-valid>");
  if (validFailures.length > 0) {
    failures.push(`npm bootstrap self-test valid plan failed: ${validFailures.join("; ")}`);
  }
  const unsafeCredentialFailures = collectPlanFailures(
    { ...plan, credentialMode: "workflow-token", credentialPersistence: "repository-secret" },
    "<npm-bootstrap-self-test-credential>"
  );
  if (
    !unsafeCredentialFailures.some((item) => item.includes("credentialMode")) ||
    !unsafeCredentialFailures.some((item) => item.includes("credentialPersistence"))
  ) {
    failures.push("npm bootstrap self-test unsafe credential mode was not rejected");
  }
  const unsafeTagFailures = collectPlanFailures({ ...plan, distTag: "latest" }, "<npm-bootstrap-self-test-tag>");
  if (!unsafeTagFailures.some((item) => item.includes("distTag"))) {
    failures.push("npm bootstrap self-test latest dist-tag was not rejected");
  }
  const missingLatestReplacementFailures = collectPlanFailures(
    {
      ...plan,
      postPublish: {
        ...plan.postPublish,
        replaceInitialLatestTag: "not-required"
      }
    },
    "<npm-bootstrap-self-test-latest-replacement>"
  );
  if (!missingLatestReplacementFailures.some((item) => item.includes("latest dist-tag replacement"))) {
    failures.push("npm bootstrap self-test missing initial latest replacement was not rejected");
  }
  const approvedWithoutEvidenceFailures = collectPlanFailures(
    {
      ...plan,
      status: "approved",
      approval: {
        ...plan.approval,
        approvedBy: "UNRECORDED",
        sourceCommit: "UNRECORDED"
      }
    },
    "<npm-bootstrap-self-test-approval>"
  );
  if (
    !approvedWithoutEvidenceFailures.some((item) => item.includes("approvedBy")) ||
    !approvedWithoutEvidenceFailures.some((item) => item.includes("sourceCommit"))
  ) {
    failures.push("npm bootstrap self-test missing approval evidence was not rejected");
  }
}

function runNpm(args) {
  const command = process.platform === "win32" ? process.execPath : "npm";
  const prefix =
    process.platform === "win32" ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : [];
  const result = spawnSync(command, [...prefix, ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_FUND: "false"
    }
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function isFullCommitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}

function isRecorded(value) {
  return typeof value === "string" && value.trim().length > 0 && !["UNRECORDED", "UNDECIDED"].includes(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}
