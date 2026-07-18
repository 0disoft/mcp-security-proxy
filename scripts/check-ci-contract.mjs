import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveExpectedVersion, validatePublishedMetadata } from "./lib/registry-smoke-contract.mjs";

const root = process.cwd();
const workflowPath = ".github/workflows/ci.yml";
const releaseWorkflowPath = ".github/workflows/release.yml";
const registrySmokeWorkflowPath = ".github/workflows/registry-smoke.yml";
const publicationReceiptWorkflowPath = ".github/workflows/publication-receipt.yml";
const registrySmokeSourcePath = "scripts/check-registry-packages.mjs";
const registryOnboardingSmokePath = "scripts/lib/registry-onboarding-smoke.mjs";
const processTreeSmokePath = "scripts/check-process-tree-smoke.mjs";
const externalFetchFixturePath = "scripts/check-external-fetch-mcp-fixture.mjs";
const policyReloadSmokePath = "scripts/smoke-policy-reload.mjs";
const ciDocPath = "docs/ops/ci.md";
const registryUrl = "https://registry.npmjs.org";
const failures = [];

const manifest = readJson("package.json");
const workflow = readText(workflowPath);
const registrySmokeWorkflow = readText(registrySmokeWorkflowPath);
const publicationReceiptWorkflow = readText(publicationReceiptWorkflowPath);
const registrySmokeSource = readText(registrySmokeSourcePath);
const registryOnboardingSmoke = readText(registryOnboardingSmokePath);
const processTreeSmoke = readText(processTreeSmokePath);
const externalFetchFixture = readText(externalFetchFixturePath);
const policyReloadSmoke = readText(policyReloadSmokePath);
const ciDoc = readText(ciDocPath);
const normalizedCiDoc = ciDoc.replace(/\s+/g, " ");
const workflowFiles = listWorkflowFiles();

const packageManager = parsePackageManager(manifest.packageManager);
const engineFloor = parseNodeEngineFloor(manifest.engines?.node);
const workflowNodeVersion = extractScalar("node-version");
const workflowPythonVersion = extractScalar("python-version");
const workflowPnpmVersion = extractCorepackPnpmVersion();

if (packageManager.name !== "pnpm") {
  failures.push("package.json: packageManager must use pnpm for CI parity");
}
if (workflowPnpmVersion !== packageManager.version) {
  failures.push(
    `${workflowPath}: corepack pnpm version ${workflowPnpmVersion || "<missing>"} must match packageManager ${packageManager.version || "<missing>"}`
  );
}
if (!workflowNodeVersion) {
  failures.push(`${workflowPath}: setup-node node-version is missing`);
} else if (!satisfiesNodeFloor(workflowNodeVersion, engineFloor)) {
  failures.push(
    `${workflowPath}: node-version ${workflowNodeVersion} must satisfy package.json engines.node ${manifest.engines?.node || "<missing>"}`
  );
}

assertContains(workflow, "on:\n  pull_request:", `${workflowPath}: pull_request trigger`);
assertContains(workflow, "push:\n    branches:\n      - main", `${workflowPath}: push main trigger`);
assertContains(workflow, "permissions:\n  contents: read", `${workflowPath}: read-only contents permission`);
assertContains(workflow, "cancel-in-progress: true", `${workflowPath}: concurrency cancellation`);
assertContains(workflow, "runs-on: ubuntu-latest", `${workflowPath}: Ubuntu runner`);
assertContains(workflow, "timeout-minutes: 15", `${workflowPath}: bounded timeout`);
assertPinnedAction(workflowPath, workflow, "actions/checkout");
assertContains(workflow, "fetch-depth: 0", `${workflowPath}: full history for reachable release target validation`);
assertPinnedAction(workflowPath, workflow, "actions/setup-node");
assertPinnedAction(workflowPath, workflow, "actions/setup-python");
assertMatches(
  workflow,
  /python-version:\s*["']?3\.11\.15["']?/u,
  `${workflowPath}: pinned Python compatibility version`
);
assertContains(workflow, "pnpm install --frozen-lockfile", `${workflowPath}: frozen lockfile install`);
assertContains(workflow, "pnpm run check", `${workflowPath}: repository check command`);
assertContains(workflow, "git diff --check", `${workflowPath}: diff hygiene command`);
assertContains(workflow, "process-tree-smoke:", `${workflowPath}: process-tree smoke job`);
assertContains(workflow, "- ubuntu-latest\n          - windows-latest", `${workflowPath}: process-tree OS matrix`);
assertContains(workflow, "pnpm run process-tree-smoke", `${workflowPath}: process-tree smoke command`);
assertContains(
  manifest.scripts?.smoke ?? "",
  "node scripts/smoke-policy-reload.mjs",
  "package.json: smoke aggregate must include atomic policy reload"
);
for (const phrase of [
  '"--watch-policy"',
  'event.event === "policy.reload_applied"',
  'event.reasonCode === "invalid_policy"',
  "renameSync(stagingPath, targetPath)",
  'evidence?.[0]?.code !== "tool.not_visible"'
]) {
  assertContains(policyReloadSmoke, phrase, `${policyReloadSmokePath}: missing reload proof phrase ${phrase}`);
}
assertContains(workflow, "fail-fast: false", `${workflowPath}: process-tree matrix completion`);
for (const phrase of [
  'process.platform === "win32"',
  'runProcessTreeScenario("abrupt-proxy-termination")',
  'proxyChild.kill("SIGKILL")',
  "extractSafeContainmentDiagnostic",
  "Windows Job Object kill-on-close"
]) {
  assertContains(processTreeSmoke, phrase, `${processTreeSmokePath}: missing abrupt termination phrase ${phrase}`);
}
assertContains(
  manifest.scripts?.["external-compatibility"] ?? "",
  "node scripts/check-external-fetch-mcp-fixture.mjs",
  "package.json: external compatibility aggregate must include the fetch-server row"
);
for (const phrase of [
  'const serverPackage = "mcp-server-fetch"',
  'const serverVersion = "2026.7.10"',
  '"--ignore-robots-txt"',
  'ips: ["127.0.0.1"]',
  'url: "http://192.0.2.1/blocked"',
  "PIP_CONFIG_FILE: pipConfigPath",
  'NODE_AUTH_TOKEN: ""',
  '"PATHEXT"',
  '"USERPROFILE"',
  "containsRawFixtureRoot"
]) {
  assertContains(
    externalFetchFixture,
    phrase,
    `${externalFetchFixturePath}: missing external fetch safety phrase ${phrase}`
  );
}
checkWorkflowPublishSurfaces(workflowFiles);
checkRegistrySmokeWorkflowContract(registrySmokeWorkflow);
checkPublicationReceiptWorkflowContract(publicationReceiptWorkflow);
checkRegistryOnboardingSmokeContract();

assertContains(ciDoc, `installs Node.js ${workflowNodeVersion}`, `${ciDocPath}: documented Node.js version`);
assertContains(ciDoc, `installs Python ${workflowPythonVersion}`, `${ciDocPath}: documented Python version`);
assertContains(ciDoc, `enables pnpm ${packageManager.version}`, `${ciDocPath}: documented pnpm version`);
assertContains(ciDoc, "runs `pnpm run check`", `${ciDocPath}: documented check command`);
assertContains(ciDoc, "runs `git diff --check`", `${ciDocPath}: documented diff hygiene command`);
assertContains(
  ciDoc,
  "runs `pnpm run process-tree-smoke` on Ubuntu and Windows",
  `${ciDocPath}: documented process-tree matrix`
);
assertContains(
  normalizedCiDoc,
  "abrupt proxy termination through Windows Job Object kill-on-close",
  `${ciDocPath}: documented Windows abrupt termination smoke`
);
assertContains(
  normalizedCiDoc,
  "runs `pnpm run registry-smoke` after all five publish steps",
  `${ciDocPath}: documented post-publish registry smoke`
);
assertContains(
  normalizedCiDoc,
  "requires an exact published semver",
  `${ciDocPath}: documented registry smoke version contract`
);
assertContains(
  ciDoc,
  "CI workflows must not publish packages",
  `${ciDocPath}: documented CI no-publish workflow guard`
);
assertContains(
  ciDoc,
  "is the only tracked workflow allowed to request `id-token: write`",
  `${ciDocPath}: documented release workflow OIDC guard`
);

checkCiContractValidator();
checkRegistrySmokeContractValidator();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

function assertPinnedAction(label, workflowText, actionName) {
  const pattern = new RegExp(`uses:\\s*${escapeRegExp(actionName)}@([^\\s#]+)`);
  const match = workflowText.match(pattern);
  if (!match) {
    failures.push(`${label}: missing ${actionName} step`);
    return;
  }
  if (!/^[a-f0-9]{40}$/i.test(match[1])) {
    failures.push(`${label}: ${actionName} must be pinned to a full commit SHA`);
  }
}

function extractScalar(key) {
  const pattern = new RegExp(`\\b${escapeRegExp(key)}:\\s*([^\\s#]+)`);
  const match = workflow.match(pattern);
  return match?.[1]?.trim().replace(/^(['"])(.*)\1$/u, "$2");
}

function extractCorepackPnpmVersion() {
  const match = workflow.match(/\bcorepack\s+prepare\s+pnpm@([^\s]+)\s+--activate\b/);
  return match?.[1]?.trim();
}

function parsePackageManager(value) {
  const match = typeof value === "string" ? value.match(/^([^@]+)@(.+)$/) : null;
  if (!match) {
    failures.push("package.json: packageManager must use name@version format");
    return { name: undefined, version: undefined };
  }
  return { name: match[1], version: match[2] };
}

function parseNodeEngineFloor(value) {
  const match = typeof value === "string" ? value.match(/^>=(\d+)\.(\d+)\.(\d+)$/) : null;
  if (!match) {
    failures.push("package.json: engines.node must use >=MAJOR.MINOR.PATCH format");
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function satisfiesNodeFloor(version, floor) {
  if (!floor) {
    return false;
  }
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    failures.push(`${workflowPath}: node-version must use MAJOR.MINOR.PATCH format`);
    return false;
  }
  const actual = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
  if (actual.major !== floor.major) {
    return false;
  }
  if (actual.minor !== floor.minor) {
    return actual.minor > floor.minor;
  }
  return actual.patch >= floor.patch;
}

function assertContains(text, needle, label) {
  if (!needle || !text.includes(needle)) {
    failures.push(label);
  }
}

function assertMatches(text, pattern, label) {
  if (!(pattern instanceof RegExp) || !pattern.test(text)) {
    failures.push(label);
  }
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function listWorkflowFiles() {
  const files = new Set(
    execFileSync("git", ["ls-files", ".github/workflows"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    })
      .split(/\r?\n/)
      .filter((file) => /\.(?:ya?ml)$/i.test(file))
      .map((file) => file.replaceAll("\\", "/"))
  );
  const workflowDir = join(root, ".github", "workflows");
  if (existsSync(workflowDir)) {
    for (const file of readdirSync(workflowDir)) {
      if (/\.(?:ya?ml)$/i.test(file)) {
        files.add(`.github/workflows/${file}`);
      }
    }
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function checkWorkflowPublishSurfaces(workflowFiles, reader = readText) {
  for (const file of workflowFiles) {
    if (file === releaseWorkflowPath) {
      checkReleaseWorkflowContract(reader(file));
      continue;
    }
    assertNoPublishWorkflowSurfaces([file], reader);
  }
}

function assertNoPublishWorkflowSurfaces(workflowFiles, reader = readText) {
  for (const file of workflowFiles) {
    const text = reader(file);
    const checks = [
      {
        pattern: /\b(?:npm|pnpm)\s+publish\b|\byarn\s+npm\s+publish\b/i,
        reason: "package publish command"
      },
      {
        pattern: /\bgh\s+release\s+create\b|\b(?:softprops\/action-gh-release|actions\/create-release)@/i,
        reason: "GitHub release creation"
      },
      {
        pattern: /^\s*(?:contents|packages|actions|deployments):\s*write\s*$/im,
        reason: "write workflow permission"
      },
      {
        pattern: /^\s*id-token:\s*write\s*$/im,
        reason: "OIDC publish permission"
      },
      {
        pattern: /\b(?:NODE_AUTH_TOKEN|NPM_TOKEN|NPM_CONFIG_\/\/REGISTRY\.NPMJS\.ORG\/:_AUTHTOKEN)\b/i,
        reason: "registry publish token"
      },
      {
        pattern: /\$\{\{\s*secrets\.(?:NODE_AUTH_TOKEN|NPM_TOKEN|NPM_PUBLISH_TOKEN|NPM_CONFIG_[^}]*AUTHTOKEN)\s*}}/i,
        reason: "registry publish secret"
      }
    ];
    for (const check of checks) {
      if (check.pattern.test(text)) {
        failures.push(
          `${file}: ${check.reason} is blocked until release automation and publish ownership are approved`
        );
      }
    }
  }
}

function checkReleaseWorkflowContract(releaseWorkflow) {
  assertContains(releaseWorkflow, "name: Release", `${releaseWorkflowPath}: workflow name`);
  assertMatches(
    releaseWorkflow,
    /tags:\s*\n\s*-\s*["']v\[0-9\]\*\.\[0-9\]\*\.\[0-9\]\*["']/u,
    `${releaseWorkflowPath}: semver tag trigger`
  );
  assertContains(
    releaseWorkflow,
    "permissions:\n  contents: read\n  id-token: write",
    `${releaseWorkflowPath}: minimal publish permissions`
  );
  assertContains(
    releaseWorkflow,
    "cancel-in-progress: false",
    `${releaseWorkflowPath}: release jobs must not cancel in progress`
  );
  assertContains(releaseWorkflow, "environment: npm", `${releaseWorkflowPath}: npm Trusted Publisher environment`);
  assertContains(releaseWorkflow, "timeout-minutes: 20", `${releaseWorkflowPath}: bounded release timeout`);
  assertPinnedAction(releaseWorkflowPath, releaseWorkflow, "actions/checkout");
  assertContains(
    releaseWorkflow,
    "fetch-depth: 0",
    `${releaseWorkflowPath}: full history for reachable release target validation`
  );
  assertPinnedAction(releaseWorkflowPath, releaseWorkflow, "actions/setup-node");
  assertPinnedAction(releaseWorkflowPath, releaseWorkflow, "actions/setup-python");
  assertMatches(
    releaseWorkflow,
    new RegExp(`python-version:\\s*["']?${escapeRegExp(workflowPythonVersion)}["']?`, "u"),
    `${releaseWorkflowPath}: Python compatibility version`
  );
  assertContains(
    releaseWorkflow,
    `corepack prepare pnpm@${packageManager.version} --activate`,
    `${releaseWorkflowPath}: pnpm version`
  );
  assertContains(
    releaseWorkflow,
    "registry-url: https://registry.npmjs.org",
    `${releaseWorkflowPath}: npm registry url`
  );
  assertContains(
    releaseWorkflow,
    "pnpm run external-compatibility",
    `${releaseWorkflowPath}: pinned external MCP fixture verification`
  );
  assertContains(releaseWorkflow, "pnpm install --frozen-lockfile", `${releaseWorkflowPath}: frozen lockfile install`);
  assertContains(releaseWorkflow, "pnpm run check", `${releaseWorkflowPath}: repository check command`);
  assertContains(
    releaseWorkflow,
    "node scripts/check-release-publish-plan.mjs",
    `${releaseWorkflowPath}: publish plan preflight`
  );
  assertContains(releaseWorkflow, "pnpm run registry-smoke", `${releaseWorkflowPath}: post-publish registry smoke`);
  for (const packageName of [
    "@0disoft/mcp-security-proxy-contracts",
    "@0disoft/mcp-security-proxy-core",
    "@0disoft/mcp-security-proxy-mcp-adapter",
    "@0disoft/mcp-security-proxy-runtime",
    "@0disoft/mcp-security-proxy-cli"
  ]) {
    assertContains(
      releaseWorkflow,
      `pnpm --filter ${packageName} publish --access public --provenance --no-git-checks`,
      `${releaseWorkflowPath}: publish command for ${packageName}`
    );
  }
  for (const forbidden of [
    /contents:\s*write/i,
    /\b(?:NODE_AUTH_TOKEN|NPM_TOKEN|NPM_PUBLISH_TOKEN)\b/i,
    /\bgh\s+release\s+create\b/i
  ]) {
    if (forbidden.test(releaseWorkflow)) {
      failures.push(
        `${releaseWorkflowPath}: release workflow must use OIDC publishing without registry tokens or GitHub release creation`
      );
    }
  }
}

function checkRegistrySmokeWorkflowContract(registrySmokeWorkflow) {
  assertContains(registrySmokeWorkflow, "name: Registry Smoke", `${registrySmokeWorkflowPath}: workflow name`);
  assertContains(
    registrySmokeWorkflow,
    'run-name: "Registry Smoke receipt: version=${{ inputs.version }}; release-run=${{ inputs.release_run_id }}"',
    `${registrySmokeWorkflowPath}: structured publication receipt request`
  );
  assertContains(registrySmokeWorkflow, "workflow_dispatch:", `${registrySmokeWorkflowPath}: manual trigger`);
  assertContains(
    registrySmokeWorkflow,
    "version:\n        description: Exact published semver to verify\n        required: true\n        type: string",
    `${registrySmokeWorkflowPath}: exact version input`
  );
  assertContains(
    registrySmokeWorkflow,
    "release_run_id:\n        description: Successful Release workflow run id for this version\n        required: true\n        type: string",
    `${registrySmokeWorkflowPath}: release run input`
  );
  assertContains(
    registrySmokeWorkflow,
    "permissions:\n  contents: read",
    `${registrySmokeWorkflowPath}: read-only contents permission`
  );
  assertContains(
    registrySmokeWorkflow,
    "cancel-in-progress: false",
    `${registrySmokeWorkflowPath}: smoke jobs must not cancel in progress`
  );
  assertContains(registrySmokeWorkflow, "runs-on: ubuntu-latest", `${registrySmokeWorkflowPath}: Ubuntu runner`);
  assertContains(registrySmokeWorkflow, "timeout-minutes: 10", `${registrySmokeWorkflowPath}: bounded timeout`);
  assertPinnedAction(registrySmokeWorkflowPath, registrySmokeWorkflow, "actions/checkout");
  assertPinnedAction(registrySmokeWorkflowPath, registrySmokeWorkflow, "actions/setup-node");
  assertContains(
    registrySmokeWorkflow,
    `node-version: ${workflowNodeVersion}`,
    `${registrySmokeWorkflowPath}: Node.js version`
  );
  assertContains(
    registrySmokeWorkflow,
    `corepack prepare pnpm@${packageManager.version} --activate`,
    `${registrySmokeWorkflowPath}: pnpm version`
  );
  assertContains(
    registrySmokeWorkflow,
    "pnpm install --frozen-lockfile",
    `${registrySmokeWorkflowPath}: frozen lockfile install`
  );
  assertContains(
    registrySmokeWorkflow,
    "MSP_REGISTRY_SMOKE_VERSION: ${{ inputs.version }}",
    `${registrySmokeWorkflowPath}: version environment`
  );
  assertContains(
    registrySmokeWorkflow,
    "pnpm run registry-smoke",
    `${registrySmokeWorkflowPath}: registry smoke command`
  );
}

function checkPublicationReceiptWorkflowContract(publicationReceiptWorkflow) {
  assertContains(
    publicationReceiptWorkflow,
    "name: Publication Receipt",
    `${publicationReceiptWorkflowPath}: workflow name`
  );
  assertContains(
    publicationReceiptWorkflow,
    "workflow_run:\n    workflows:\n      - Registry Smoke\n    types:\n      - completed",
    `${publicationReceiptWorkflowPath}: completed Registry Smoke trigger`
  );
  assertContains(
    publicationReceiptWorkflow,
    "permissions:\n  actions: read\n  contents: read",
    `${publicationReceiptWorkflowPath}: read-only actions and contents permissions`
  );
  assertContains(
    publicationReceiptWorkflow,
    "cancel-in-progress: false",
    `${publicationReceiptWorkflowPath}: receipt jobs must not cancel in progress`
  );
  assertContains(
    publicationReceiptWorkflow,
    "if: ${{ github.event.workflow_run.conclusion == 'success' }}",
    `${publicationReceiptWorkflowPath}: successful smoke conclusion gate`
  );
  assertContains(
    publicationReceiptWorkflow,
    "runs-on: ubuntu-latest",
    `${publicationReceiptWorkflowPath}: Ubuntu runner`
  );
  assertContains(
    publicationReceiptWorkflow,
    "timeout-minutes: 5",
    `${publicationReceiptWorkflowPath}: bounded timeout`
  );
  assertPinnedAction(publicationReceiptWorkflowPath, publicationReceiptWorkflow, "actions/checkout");
  assertPinnedAction(publicationReceiptWorkflowPath, publicationReceiptWorkflow, "actions/setup-node");
  assertPinnedAction(publicationReceiptWorkflowPath, publicationReceiptWorkflow, "actions/upload-artifact");
  assertContains(
    publicationReceiptWorkflow,
    `node-version: ${workflowNodeVersion}`,
    `${publicationReceiptWorkflowPath}: Node.js version`
  );
  for (const phrase of [
    "GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}",
    "MSP_PUBLICATION_RECEIPT_REQUEST: ${{ github.event.workflow_run.display_title }}",
    "MSP_REGISTRY_SMOKE_RUN_ID: ${{ github.event.workflow_run.id }}",
    "MSP_PUBLICATION_RECEIPT_OUTPUT_DIR: publication-receipt",
    "node scripts/generate-publication-receipt.mjs",
    "path: publication-receipt/*.publication.json",
    "if-no-files-found: error"
  ]) {
    assertContains(
      publicationReceiptWorkflow,
      phrase,
      `${publicationReceiptWorkflowPath}: missing receipt contract phrase ${phrase}`
    );
  }
}

function checkRegistryOnboardingSmokeContract() {
  assertContains(
    registrySmokeSource,
    "runRegistryOnboardingSmoke({ consumerRoot, expectedVersion })",
    `${registrySmokeSourcePath}: registry onboarding invocation`
  );
  for (const phrase of [
    '@modelcontextprotocol/sdk", version: "1.29.0"',
    '@modelcontextprotocol/server-filesystem", version: "2026.7.4"',
    'schemaVersion: "msp.registry-onboarding-smoke.v1"',
    'visibleTools) !== JSON.stringify(["read_text_file"])',
    'evidenceCodes?.includes("policy.default_deny")',
    "registry onboarding smoke audit output exposed fixture paths or raw arguments"
  ]) {
    assertContains(
      registryOnboardingSmoke,
      phrase,
      `${registryOnboardingSmokePath}: missing registry onboarding contract phrase`
    );
  }
  assertContains(
    normalizedCiDoc,
    "starts the registry-installed CLI as a real stdio proxy",
    `${ciDocPath}: documented registry onboarding session`
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkCiContractValidator() {
  const validPackageManagerFailures = collectCiContractFailures(() => {
    const parsed = parsePackageManager("pnpm@11.7.0");
    if (parsed.name !== "pnpm" || parsed.version !== "11.7.0") {
      failures.push("ci-contract self-test valid packageManager was not parsed");
    }
  });
  if (validPackageManagerFailures.length > 0) {
    failures.push(`ci-contract self-test valid packageManager failed: ${validPackageManagerFailures.join("; ")}`);
  }

  const invalidPackageManagerFailures = collectCiContractFailures(() => {
    parsePackageManager("pnpm");
  });
  if (!invalidPackageManagerFailures.some((item) => item.includes("packageManager must use name@version format"))) {
    failures.push(
      `ci-contract self-test invalid packageManager was not rejected: ${invalidPackageManagerFailures.join("; ")}`
    );
  }

  const validNodeFloorFailures = collectCiContractFailures(() => {
    const floor = parseNodeEngineFloor(">=24.0.0");
    if (!satisfiesNodeFloor("24.11.1", floor)) {
      failures.push("ci-contract self-test node version should satisfy floor");
    }
    if (satisfiesNodeFloor("23.11.1", floor)) {
      failures.push("ci-contract self-test node version below floor was accepted");
    }
  });
  if (validNodeFloorFailures.length > 0) {
    failures.push(`ci-contract self-test node floor failed: ${validNodeFloorFailures.join("; ")}`);
  }

  const invalidNodeVersionFailures = collectCiContractFailures(() => {
    satisfiesNodeFloor("24", { major: 24, minor: 0, patch: 0 });
  });
  if (!invalidNodeVersionFailures.some((item) => item.includes("node-version must use MAJOR.MINOR.PATCH format"))) {
    failures.push(
      `ci-contract self-test invalid node-version was not rejected: ${invalidNodeVersionFailures.join("; ")}`
    );
  }

  const unpinnedActionFailures = collectCiContractFailures(() => {
    assertPinnedAction("<ci-contract-self-test-unpinned-action>", "uses: actions/checkout@v7", "actions/checkout");
  });
  if (!unpinnedActionFailures.some((item) => item.includes("actions/checkout must be pinned to a full commit SHA"))) {
    failures.push(`ci-contract self-test unpinned action was not rejected: ${unpinnedActionFailures.join("; ")}`);
  }

  const missingActionFailures = collectCiContractFailures(() => {
    assertPinnedAction(
      "<ci-contract-self-test-missing-action>",
      "uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e",
      "actions/checkout"
    );
  });
  if (!missingActionFailures.some((item) => item.includes("missing actions/checkout step"))) {
    failures.push(`ci-contract self-test missing action was not rejected: ${missingActionFailures.join("; ")}`);
  }

  const publishWorkflowFailures = collectCiContractFailures(() => {
    const workflowFiles = ["<ci-contract-self-test-publish-workflow>.yml"];
    checkWorkflowPublishSurfaces(workflowFiles, readTextForPublishWorkflowSelfTest);
  });
  if (
    !publishWorkflowFailures.some((item) => item.includes("package publish command")) ||
    !publishWorkflowFailures.some((item) => item.includes("write workflow permission")) ||
    !publishWorkflowFailures.some((item) => item.includes("OIDC publish permission")) ||
    !publishWorkflowFailures.some((item) => item.includes("registry publish token")) ||
    !publishWorkflowFailures.some((item) => item.includes("GitHub release creation"))
  ) {
    failures.push(`ci-contract self-test publish workflow was not rejected: ${publishWorkflowFailures.join("; ")}`);
  }

  const invalidReleaseWorkflowFailures = collectCiContractFailures(() => {
    checkWorkflowPublishSurfaces([releaseWorkflowPath], () => "name: Release\npermissions:\n  contents: write\n");
  });
  if (
    !invalidReleaseWorkflowFailures.some((item) => item.includes("semver tag trigger")) ||
    !invalidReleaseWorkflowFailures.some((item) => item.includes("minimal publish permissions")) ||
    !invalidReleaseWorkflowFailures.some((item) => item.includes("release workflow must use OIDC publishing"))
  ) {
    failures.push(
      `ci-contract self-test invalid release workflow was not rejected: ${invalidReleaseWorkflowFailures.join("; ")}`
    );
  }
}

function checkRegistrySmokeContractValidator() {
  const version = "0.2.0-alpha.1";
  if (resolveExpectedVersion(["--", "--version", version], {}) !== version) {
    failures.push("registry-smoke contract self-test did not parse an exact argument version");
  }
  if (resolveExpectedVersion([], { GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: `v${version}` }) !== version) {
    failures.push("registry-smoke contract self-test did not parse a release tag version");
  }
  assertRegistrySmokeContractRejects(
    () => resolveExpectedVersion(["--version", "latest"], {}),
    "must be exact semver",
    "dist-tag version"
  );
  assertRegistrySmokeContractRejects(
    () => resolveExpectedVersion(["--version", version], { MSP_REGISTRY_SMOKE_VERSION: "0.2.0-alpha.2" }),
    "unambiguous exact version",
    "conflicting version sources"
  );

  const spec = { name: "@0disoft/mcp-security-proxy-core" };
  const metadata = {
    version,
    dist: {
      integrity: "sha512-test",
      tarball: `${registryUrl}/${spec.name}/-/mcp-security-proxy-core-${version}.tgz`,
      attestations: {
        url: `${registryUrl}/-/npm/v1/attestations/test`,
        provenance: { predicateType: "https://slsa.dev/provenance/v1" }
      }
    }
  };
  validatePublishedMetadata(spec, metadata, version, registryUrl);
  assertRegistrySmokeContractRejects(
    () =>
      validatePublishedMetadata(
        spec,
        { ...metadata, dist: { ...metadata.dist, attestations: undefined } },
        version,
        registryUrl
      ),
    "missing npm SLSA provenance",
    "missing provenance"
  );
}

function assertRegistrySmokeContractRejects(operation, expectedMessage, label) {
  try {
    operation();
    failures.push(`registry-smoke contract self-test accepted ${label}`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes(expectedMessage)) {
      failures.push(`registry-smoke contract self-test rejected ${label} for an unexpected reason`);
    }
  }
}

function collectCiContractFailures(fn) {
  const before = failures.length;
  fn();
  return failures.splice(before);
}

function readTextForPublishWorkflowSelfTest() {
  return `
permissions:
  contents: write
  id-token: write
jobs:
  publish:
    steps:
      - run: pnpm publish
      - run: gh release create v0.1.0
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`;
}
