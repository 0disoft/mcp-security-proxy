import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workflowPath = ".github/workflows/ci.yml";
const ciDocPath = "docs/ops/ci.md";
const failures = [];

const manifest = readJson("package.json");
const workflow = readText(workflowPath);
const ciDoc = readText(ciDocPath);
const trackedWorkflowFiles = listTrackedWorkflowFiles();

const packageManager = parsePackageManager(manifest.packageManager);
const engineFloor = parseNodeEngineFloor(manifest.engines?.node);
const workflowNodeVersion = extractScalar("node-version");
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
assertPinnedAction(workflowPath, workflow, "actions/setup-node");
assertContains(workflow, "pnpm install --frozen-lockfile", `${workflowPath}: frozen lockfile install`);
assertContains(workflow, "pnpm run check", `${workflowPath}: repository check command`);
assertContains(workflow, "git diff --check", `${workflowPath}: diff hygiene command`);
assertNoPublishWorkflowSurfaces(trackedWorkflowFiles);

assertContains(ciDoc, `installs Node.js ${workflowNodeVersion}`, `${ciDocPath}: documented Node.js version`);
assertContains(ciDoc, `enables pnpm ${packageManager.version}`, `${ciDocPath}: documented pnpm version`);
assertContains(ciDoc, "runs `pnpm run check`", `${ciDocPath}: documented check command`);
assertContains(ciDoc, "runs `git diff --check`", `${ciDocPath}: documented diff hygiene command`);
assertContains(
  ciDoc,
  "Tracked GitHub Actions workflows must not publish packages",
  `${ciDocPath}: documented no-publish workflow guard`
);
assertContains(
  ciDoc,
  "explicitly approved",
  `${ciDocPath}: documented release automation approval guard`
);

checkCiContractValidator();

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
  return match?.[1]?.trim();
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

function readJson(path) {
  return JSON.parse(readText(path));
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function listTrackedWorkflowFiles() {
  return execFileSync("git", ["ls-files", ".github/workflows"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split(/\r?\n/)
    .filter((file) => /\.(?:ya?ml)$/i.test(file));
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
    failures.push(`ci-contract self-test invalid packageManager was not rejected: ${invalidPackageManagerFailures.join("; ")}`);
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
    failures.push(`ci-contract self-test invalid node-version was not rejected: ${invalidNodeVersionFailures.join("; ")}`);
  }

  const unpinnedActionFailures = collectCiContractFailures(() => {
    assertPinnedAction("<ci-contract-self-test-unpinned-action>", "uses: actions/checkout@v7", "actions/checkout");
  });
  if (!unpinnedActionFailures.some((item) => item.includes("actions/checkout must be pinned to a full commit SHA"))) {
    failures.push(`ci-contract self-test unpinned action was not rejected: ${unpinnedActionFailures.join("; ")}`);
  }

  const missingActionFailures = collectCiContractFailures(() => {
    assertPinnedAction("<ci-contract-self-test-missing-action>", "uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e", "actions/checkout");
  });
  if (!missingActionFailures.some((item) => item.includes("missing actions/checkout step"))) {
    failures.push(`ci-contract self-test missing action was not rejected: ${missingActionFailures.join("; ")}`);
  }

  const publishWorkflowFailures = collectCiContractFailures(() => {
    const workflowFiles = ["<ci-contract-self-test-publish-workflow>.yml"];
    assertNoPublishWorkflowSurfaces(workflowFiles, readTextForPublishWorkflowSelfTest);
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
