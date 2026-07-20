import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseDocument } from "yaml";

const root = process.cwd();
const releaseRecordsDir = join(root, "docs", "ops", "release-records");
const expectedNodeEngine = ">=24.0.0";
const expectedLicense = "Apache-2.0";
const expectedRepositoryUrl = "https://github.com/0disoft/mcp-security-proxy.git";
const expectedHomepage = "https://github.com/0disoft/mcp-security-proxy#readme";
const expectedBugsUrl = "https://github.com/0disoft/mcp-security-proxy/issues";
const expectedRegistry = "https://registry.npmjs.org";
const externalRuntimeDependencyRecordPath = join(root, "docs", "ops", "external-runtime-dependencies.json");
const expectedWorkspacePackages = ["cli", "contracts", "core", "mcp-adapter", "proxy-runtime", "testkit"];
const expectedPublishablePackages = new Set(["cli", "contracts", "core", "mcp-adapter", "proxy-runtime"]);
const expectedPackageFiles = new Map([
  ["cli", ["dist"]],
  ["contracts", ["dist", "schemas"]],
  ["core", ["dist"]],
  ["mcp-adapter", ["dist"]],
  ["proxy-runtime", ["dist"]],
  ["testkit", ["dist"]]
]);
const expectedEntrypointReExports = new Map([
  ["cli", ["./commands.js"]],
  ["contracts", ["./policy.js", "./decision.js", "./audit.js", "./ops.js", "./validation.js"]],
  [
    "core",
    [
      "./method-policy.js",
      "./matchers.js",
      "./classifier.js",
      "./evaluator.js",
      "./redactor.js",
      "./audit.js",
      "./tool-policy-coverage.js"
    ]
  ],
  ["mcp-adapter", ["./jsonrpc.js", "./method-policy.js", "./tool-call.js"]],
  [
    "proxy-runtime",
    ["./startup-plan.js", "./audit-correlation.js", "./approval-conformance.js", "./session.js", "./stdio-bridge.js"]
  ],
  ["testkit", ["./fixtures.js"]]
]);
const expectedWorkspaceGlobs = ["packages/*"];
const dependencyGroups = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const mcpSdkDependencyPatterns = [/^@modelcontextprotocol\/sdk$/, /\bmcp-sdk\b/i, /\bmodelcontextprotocol\b/i];
const currentHead = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
}).trim();

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const formatPath = (path) => relative(root, path).replaceAll("\\", "/");

const failures = [];
const releasePackageVersions = collectReleasePackageVersions(readReleaseRecords());

const assertEqual = (condition, message) => {
  if (!condition) {
    failures.push(message);
  }
};

const externalRuntimeDependencyDecisions = readExternalRuntimeDependencyDecisions();
const observedExternalRuntimeDependencyDecisions = new Set();

const checkCommonManifest = (manifest, manifestPath, options = {}) => {
  const file = formatPath(manifestPath);
  if (options.releaseVersion) {
    assertEqual(
      manifest.private !== true,
      `${file}: private must be removed or false when release readiness records it as public`
    );
  } else {
    assertEqual(manifest.private === true, `${file}: private must stay true before public release`);
  }
  assertEqual(manifest.type === "module", `${file}: type must be module`);
  assertEqual(manifest.license === expectedLicense, `${file}: license must be ${expectedLicense}`);
  assertEqual(manifest.engines?.node === expectedNodeEngine, `${file}: engines.node must be ${expectedNodeEngine}`);
};

const checkWorkspacePackage = (manifest, manifestPath, packageReleaseVersions = releasePackageVersions) => {
  const file = formatPath(manifestPath);
  const packageRoot = manifestPath.slice(0, -"package.json".length);
  const packageDirectory = file.split("/")[1];
  const releaseVersion = packageReleaseVersions.get(file);
  checkCommonManifest(manifest, manifestPath, { releaseVersion });
  if (releaseVersion) {
    assertEqual(
      manifest.version === releaseVersion,
      `${file}: version must match release readiness version ${releaseVersion}`
    );
  } else {
    assertEqual(
      manifest.version === "0.0.0",
      `${file}: version must stay 0.0.0 until release readiness records a public version`
    );
  }
  assertEqual(
    typeof manifest.name === "string" && manifest.name.startsWith("@0disoft/mcp-security-proxy-"),
    `${file}: package name must stay under @0disoft/mcp-security-proxy-*`
  );
  assertEqual(
    typeof manifest.description === "string" && manifest.description.trim().length > 0,
    `${file}: description must identify the package purpose`
  );
  assertEqual(manifest.types === "./dist/index.d.ts", `${file}: types must point at ./dist/index.d.ts`);
  assertEqual(
    manifest.exports?.["."]?.types === "./dist/index.d.ts",
    `${file}: exports[.].types must point at ./dist/index.d.ts`
  );
  assertEqual(
    manifest.exports?.["."]?.default === "./dist/index.js",
    `${file}: exports[.].default must point at ./dist/index.js`
  );
  assertEqual(manifest.repository?.type === "git", `${file}: repository.type must be git`);
  assertEqual(
    manifest.repository?.url === expectedRepositoryUrl,
    `${file}: repository.url must match the GitHub repository`
  );
  assertEqual(
    manifest.repository?.directory === `packages/${packageDirectory}`,
    `${file}: repository.directory must match its workspace path`
  );
  assertEqual(manifest.homepage === expectedHomepage, `${file}: homepage must point at the repository README`);
  assertEqual(manifest.bugs?.url === expectedBugsUrl, `${file}: bugs.url must point at the repository issues page`);
  assertEqual(manifest.sideEffects === false, `${file}: sideEffects must be false for the ESM package entrypoint`);
  assertEqual(
    JSON.stringify(manifest.files) === JSON.stringify(expectedPackageFiles.get(packageDirectory)),
    `${file}: files must include only the recorded package artifact paths`
  );
  if (expectedPublishablePackages.has(packageDirectory)) {
    assertEqual(
      manifest.publishConfig?.access === "public",
      `${file}: publishConfig.access must be public for a release-recorded package`
    );
    assertEqual(
      manifest.publishConfig?.registry === expectedRegistry,
      `${file}: publishConfig.registry must be npmjs.org`
    );
  } else {
    assertEqual(manifest.publishConfig === undefined, `${file}: private-only packages must not declare publishConfig`);
  }
  assertEqual(
    existsSync(join(packageRoot, "src", "index.ts")),
    `${file}: src/index.ts must exist as the build source entrypoint`
  );
  assertEqual(
    existsSync(join(packageRoot, "dist", "index.js")),
    `${file}: dist/index.js must exist after package-surface build`
  );
  assertEqual(
    existsSync(join(packageRoot, "dist", "index.d.ts")),
    `${file}: dist/index.d.ts must exist after package-surface build`
  );
  assertEqual(
    existsSync(join(packageRoot, "tsconfig.json")),
    `${file}: tsconfig.json must exist for package build/typecheck ownership`
  );
  assertEqual(
    existsSync(join(packageRoot, "tsconfig.build.json")),
    `${file}: tsconfig.build.json must exist for test-excluded package builds`
  );
  assertEqual(
    manifest.scripts?.build === "tsc -p tsconfig.build.json",
    `${file}: build script must use tsc -p tsconfig.build.json`
  );
  assertEqual(
    manifest.scripts?.typecheck === "tsc -p tsconfig.json --noEmit",
    `${file}: typecheck script must use tsc -p tsconfig.json --noEmit`
  );
};

const checkDependencies = (manifest, manifestPath, workspacePackageNames) => {
  const file = formatPath(manifestPath);
  checkDependencyDecisionGuards(manifest, file);
  for (const group of dependencyGroups) {
    const dependencies = manifest[group] ?? {};
    for (const [name, version] of Object.entries(dependencies)) {
      if (group === "devDependencies") {
        continue;
      }
      if (!workspacePackageNames.has(name)) {
        const decisionKey = createExternalRuntimeDependencyDecisionKey(file, group, name);
        const decision = externalRuntimeDependencyDecisions.get(decisionKey);
        if (!decision) {
          failures.push(`${file}: ${group}.${name} must be recorded in docs/ops/external-runtime-dependencies.json`);
          continue;
        }
        assertEqual(
          version === decision.version,
          `${file}: ${group}.${name} must use recorded exact version ${decision.version}`
        );
        observedExternalRuntimeDependencyDecisions.add(decisionKey);
        continue;
      }
      assertEqual(version === "workspace:*", `${file}: ${group}.${name} must use workspace:*`);
    }
  }
};

const checkDependencyDecisionGuards = (manifest, file) => {
  for (const group of dependencyGroups) {
    const dependencies = manifest[group] ?? {};
    for (const name of Object.keys(dependencies)) {
      checkMcpSdkDependency(name, file, group);
    }
  }
};

const checkRootRuntimeDependencies = (manifest, file) => {
  for (const group of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = manifest[group] ?? {};
    for (const name of Object.keys(dependencies)) {
      failures.push(
        `${file}: ${group}.${name} must not be declared at the root workspace before release readiness records external runtime dependencies`
      );
    }
  }
};

const checkMcpSdkDependency = (name, file, group) => {
  if (mcpSdkDependencyPatterns.some((pattern) => pattern.test(name))) {
    failures.push(`${file}: ${group}.${name} is prohibited by the ADR 0008 runtime MCP SDK boundary`);
  }
};

const checkPackageSurfaceValidator = () => {
  const releaseRecordPackages = collectReleasePackageVersions([
    {
      status: "approved",
      releaseVersion: "0.1.0-alpha.0",
      targetCommit: currentHead,
      publicPackages: [
        {
          workspacePath: "packages/cli"
        }
      ]
    }
  ]);
  if (releaseRecordPackages.get("packages/cli/package.json") !== "0.1.0-alpha.0") {
    failures.push("package-surface self-test release record package version was not collected");
  }

  const validReleaseManifest = {
    private: false,
    type: "module",
    license: expectedLicense,
    description: "CLI package",
    repository: {
      type: "git",
      url: expectedRepositoryUrl,
      directory: "packages/cli"
    },
    homepage: expectedHomepage,
    bugs: {
      url: expectedBugsUrl
    },
    files: ["dist"],
    sideEffects: false,
    engines: {
      node: expectedNodeEngine
    },
    version: "0.1.0-alpha.0",
    name: "@0disoft/mcp-security-proxy-cli",
    types: "./dist/index.d.ts",
    exports: {
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js"
      }
    },
    publishConfig: {
      access: "public",
      registry: expectedRegistry
    },
    scripts: {
      build: "tsc -p tsconfig.build.json",
      typecheck: "tsc -p tsconfig.json --noEmit"
    }
  };

  const releaseManifestFailures = collectPackageSurfaceFailures(() => {
    checkWorkspacePackage(validReleaseManifest, join(root, "packages", "cli", "package.json"), releaseRecordPackages);
  });
  if (releaseManifestFailures.length > 0) {
    failures.push(`package-surface self-test release manifest failed: ${releaseManifestFailures.join("; ")}`);
  }

  const privateReleaseManifestFailures = collectPackageSurfaceFailures(() => {
    checkWorkspacePackage(
      {
        ...validReleaseManifest,
        private: true
      },
      join(root, "packages", "cli", "package.json"),
      releaseRecordPackages
    );
  });
  if (!privateReleaseManifestFailures.some((item) => item.includes("private must be removed or false"))) {
    failures.push(
      `package-surface self-test private release manifest was not rejected: ${privateReleaseManifestFailures.join("; ")}`
    );
  }

  const versionMismatchReleaseManifestFailures = collectPackageSurfaceFailures(() => {
    checkWorkspacePackage(
      {
        ...validReleaseManifest,
        version: "0.1.0-alpha.1"
      },
      join(root, "packages", "cli", "package.json"),
      releaseRecordPackages
    );
  });
  if (
    !versionMismatchReleaseManifestFailures.some((item) =>
      item.includes("version must match release readiness version")
    )
  ) {
    failures.push(
      `package-surface self-test release manifest version mismatch was not rejected: ${versionMismatchReleaseManifestFailures.join("; ")}`
    );
  }

  const conflictingReleaseRecordFailures = collectPackageSurfaceFailures(() => {
    collectReleasePackageVersions([
      {
        status: "approved",
        releaseVersion: "0.1.0-alpha.0",
        targetCommit: currentHead,
        publicPackages: [{ workspacePath: "packages/cli" }]
      },
      {
        status: "approved",
        releaseVersion: "0.1.0-alpha.1",
        targetCommit: currentHead,
        publicPackages: [{ workspacePath: "packages/cli" }]
      }
    ]);
  });
  if (!conflictingReleaseRecordFailures.some((item) => item.includes("conflicting release versions"))) {
    failures.push(
      `package-surface self-test conflicting release records were not rejected: ${conflictingReleaseRecordFailures.join("; ")}`
    );
  }

  const historicalTarget = getHistoricalReachableCommit();
  const latestReleaseRecordPackages = collectReleasePackageVersions([
    {
      status: "approved",
      releaseVersion: "0.1.0-alpha.1",
      targetCommit: currentHead,
      publicPackages: [{ workspacePath: "packages/cli" }]
    },
    {
      status: "approved",
      releaseVersion: "0.1.0-alpha.0",
      targetCommit: historicalTarget,
      publicPackages: [{ workspacePath: "packages/cli" }]
    }
  ]);
  if (latestReleaseRecordPackages.get("packages/cli/package.json") !== "0.1.0-alpha.1") {
    failures.push("package-surface self-test latest linear release record did not own package posture");
  }

  const nonApprovedReleaseRecordPackages = collectReleasePackageVersions([
    {
      status: "proposed",
      releaseVersion: "0.1.0-alpha.0",
      publicPackages: [{ workspacePath: "packages/cli" }]
    },
    {
      status: "blocked",
      releaseVersion: "0.1.0-alpha.1",
      publicPackages: [{ workspacePath: "packages/core" }]
    }
  ]);
  if (nonApprovedReleaseRecordPackages.size !== 0) {
    failures.push("package-surface self-test non-approved release records unlocked public package posture");
  }

  const reachableApprovedReleaseRecordPackages = collectReleasePackageVersions([
    {
      status: "approved",
      releaseVersion: "0.1.0-alpha.0",
      targetCommit: getHistoricalReachableCommit(),
      publicPackages: [{ workspacePath: "packages/cli" }]
    }
  ]);
  if (reachableApprovedReleaseRecordPackages.get("packages/cli/package.json") !== "0.1.0-alpha.0") {
    failures.push("package-surface self-test reachable approved release records did not unlock package posture");
  }

  const unreachableApprovedReleaseRecordPackages = collectReleasePackageVersions([
    {
      status: "approved",
      releaseVersion: "0.1.0-alpha.0",
      targetCommit: "0000000000000000000000000000000000000000",
      publicPackages: [{ workspacePath: "packages/cli" }]
    }
  ]);
  if (unreachableApprovedReleaseRecordPackages.size !== 0) {
    failures.push("package-surface self-test unreachable approved release records unlocked current package posture");
  }

  const sdkDependencyFailures = collectPackageSurfaceFailures(() => {
    checkDependencyDecisionGuards(
      {
        devDependencies: {
          "@modelcontextprotocol/sdk": "^1.0.0"
        }
      },
      "<package-surface-self-test-mcp-sdk-dependency>"
    );
  });
  if (!sdkDependencyFailures.some((item) => item.includes("prohibited by the ADR 0008 runtime MCP SDK boundary"))) {
    failures.push(`package-surface self-test MCP SDK dependency was not rejected: ${sdkDependencyFailures.join("; ")}`);
  }

  const rootRuntimeDependencyFailures = collectPackageSurfaceFailures(() => {
    checkRootRuntimeDependencies(
      {
        dependencies: {
          "left-pad": "^1.3.0"
        }
      },
      "<package-surface-self-test-root-runtime-dependency>"
    );
  });
  if (!rootRuntimeDependencyFailures.some((item) => item.includes("must not be declared at the root workspace"))) {
    failures.push(
      `package-surface self-test root runtime dependency was not rejected: ${rootRuntimeDependencyFailures.join("; ")}`
    );
  }

  const unrecordedExternalDependencyFailures = collectPackageSurfaceFailures(() => {
    checkDependencies(
      {
        dependencies: {
          "left-pad": "1.3.0"
        }
      },
      join(root, "packages", "core", "package.json"),
      new Set()
    );
  });
  if (
    !unrecordedExternalDependencyFailures.some((item) =>
      item.includes("must be recorded in docs/ops/external-runtime-dependencies.json")
    )
  ) {
    failures.push(
      `package-surface self-test unrecorded external dependency was not rejected: ${unrecordedExternalDependencyFailures.join("; ")}`
    );
  }

  const documentedPackageFailures = collectPackageSurfaceFailures(() => {
    checkDocumentedPackageSurfaceNames("<package-surface-self-test-documented-packages>", ["core"], ["core", "cli"]);
  });
  if (!documentedPackageFailures.some((item) => item.includes("documented package surfaces"))) {
    failures.push(
      `package-surface self-test documented package drift was not rejected: ${documentedPackageFailures.join("; ")}`
    );
  }

  const workspaceGlobFailures = collectPackageSurfaceFailures(() => {
    checkWorkspacePackageGlobNames("<package-surface-self-test-workspace-globs>", ["packages/*", "examples/*"]);
  });
  if (!workspaceGlobFailures.some((item) => item.includes("workspace package globs"))) {
    failures.push(
      `package-surface self-test workspace glob drift was not rejected: ${workspaceGlobFailures.join("; ")}`
    );
  }

  const workspaceDirectoryFailures = collectPackageSurfaceFailures(() => {
    checkWorkspacePackageDirectoryNames(
      "<package-surface-self-test-workspace-directories>",
      ["cli", "scratch"],
      ["cli"]
    );
  });
  if (!workspaceDirectoryFailures.some((item) => item.includes("workspace package directories"))) {
    failures.push(
      `package-surface self-test workspace directory drift was not rejected: ${workspaceDirectoryFailures.join("; ")}`
    );
  }

  const entrypointReExportFailures = collectPackageSurfaceFailures(() => {
    checkEntrypointReExportNames("<package-surface-self-test-entrypoint-reexports>", ["./index.js"], ["./commands.js"]);
  });
  if (!entrypointReExportFailures.some((item) => item.includes("entrypoint re-exports"))) {
    failures.push(
      `package-surface self-test entrypoint re-export drift was not rejected: ${entrypointReExportFailures.join("; ")}`
    );
  }

  const distArtifactFailures = collectPackageSurfaceFailures(() => {
    checkDistArtifactFileNames("<package-surface-self-test-dist-artifacts>", [
      "dist/index.js",
      "dist/commands.test.js",
      "dist/commands.test.d.ts",
      "dist/commands.test.js.map",
      "dist/commands.spec.d.ts.map"
    ]);
  });
  if (!distArtifactFailures.some((item) => item.includes("must not contain emitted test artifacts"))) {
    failures.push(`package-surface self-test dist test artifact was not rejected: ${distArtifactFailures.join("; ")}`);
  }
};

const collectPackageSurfaceFailures = (fn) => {
  const before = failures.length;
  fn();
  return failures.splice(before);
};

function readReleaseRecords() {
  if (!existsSync(releaseRecordsDir)) {
    return [];
  }
  return readdirSync(releaseRecordsDir)
    .filter((name) => name.endsWith(".release.json"))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => readJson(join(releaseRecordsDir, name)));
}

function collectReleasePackageVersions(records) {
  const packageApprovals = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      continue;
    }
    if (record.status !== "approved") {
      continue;
    }
    if (!isReachableCommit(record.targetCommit)) {
      continue;
    }
    if (!isNonPlaceholderString(record.releaseVersion) || !Array.isArray(record.publicPackages)) {
      continue;
    }
    for (const item of record.publicPackages) {
      if (!item || typeof item !== "object" || !isNonPlaceholderString(item.workspacePath)) {
        continue;
      }
      const packageManifestPath = `${item.workspacePath}/package.json`;
      const previous = packageApprovals.get(packageManifestPath);
      if (!previous) {
        packageApprovals.set(packageManifestPath, {
          targetCommit: record.targetCommit,
          version: record.releaseVersion
        });
        continue;
      }
      if (previous.targetCommit === record.targetCommit) {
        if (previous.version !== record.releaseVersion) {
          failures.push(
            `${packageManifestPath}: conflicting release versions ${previous.version} and ${record.releaseVersion} at target ${record.targetCommit}`
          );
        }
        continue;
      }
      if (isAncestorCommit(previous.targetCommit, record.targetCommit)) {
        packageApprovals.set(packageManifestPath, {
          targetCommit: record.targetCommit,
          version: record.releaseVersion
        });
        continue;
      }
      if (!isAncestorCommit(record.targetCommit, previous.targetCommit)) {
        failures.push(
          `${packageManifestPath}: approved release targets ${previous.targetCommit} and ${record.targetCommit} are not on one linear history`
        );
      }
    }
  }
  return new Map([...packageApprovals].map(([path, approval]) => [path, approval.version]));
}

function isNonPlaceholderString(value) {
  return typeof value === "string" && value.trim().length > 0 && value !== "UNDECIDED" && value !== "UNRECORDED";
}

function isReachableCommit(value) {
  if (!isNonPlaceholderString(value)) {
    return false;
  }
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

function isAncestorCommit(ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
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
    return (
      execFileSync("git", ["rev-list", "--max-count=1", "--skip=1", "HEAD"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim() || currentHead
    );
  } catch {
    return currentHead;
  }
}

const rootManifestPath = join(root, "package.json");
const rootManifest = readJson(rootManifestPath);
checkCommonManifest(rootManifest, rootManifestPath);
assertEqual(
  rootManifest.name === "mcp-security-proxy-workspace",
  "package.json: workspace package name changed unexpectedly"
);
assertEqual(rootManifest.version === "0.0.0", "package.json: workspace version must stay 0.0.0 before public release");
assertEqual(
  rootManifest.scripts?.typecheck === "pnpm build && pnpm -r typecheck",
  "package.json: workspace typecheck must build declaration entrypoints before recursive typecheck"
);
checkDependencyDecisionGuards(rootManifest, "package.json");
checkRootRuntimeDependencies(rootManifest, "package.json");
checkDocumentedPackageSurfaces("docs/library/package-surface.md", expectedWorkspacePackages);
checkWorkspacePackageGlobs("pnpm-workspace.yaml", expectedWorkspaceGlobs);

const packagesDir = join(root, "packages");
assertEqual(existsSync(packagesDir), "packages/: workspace packages directory is missing");

if (existsSync(packagesDir)) {
  const actualPackageDirectories = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  checkWorkspacePackageDirectoryNames("packages/", actualPackageDirectories, expectedWorkspacePackages);

  const packageManifestPaths = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, "package.json"))
    .filter((path) => existsSync(path))
    .sort((left, right) => left.localeCompare(right));

  assertEqual(packageManifestPaths.length > 0, "packages/: no package manifests found");

  const actualWorkspacePackages = packageManifestPaths
    .map((path) => relative(packagesDir, path).split(/[\\/]/)[0])
    .sort((left, right) => left.localeCompare(right));
  assertEqual(
    JSON.stringify(actualWorkspacePackages) === JSON.stringify(expectedWorkspacePackages),
    `packages/: expected workspace packages ${expectedWorkspacePackages.join(", ")}, got ${actualWorkspacePackages.join(", ")}`
  );

  const workspacePackageNames = new Set(packageManifestPaths.map((path) => readJson(path).name));

  for (const manifestPath of packageManifestPaths) {
    const manifest = readJson(manifestPath);
    checkWorkspacePackage(manifest, manifestPath);
    checkDependencies(manifest, manifestPath, workspacePackageNames);
    checkWorkspacePackageEntrypointReExports(manifestPath);
    checkWorkspacePackageDistArtifacts(manifestPath);
  }

  for (const decisionKey of externalRuntimeDependencyDecisions.keys()) {
    assertEqual(
      observedExternalRuntimeDependencyDecisions.has(decisionKey),
      `docs/ops/external-runtime-dependencies.json: unused decision ${decisionKey}`
    );
  }

  const cliManifestPath = join(packagesDir, "cli", "package.json");
  if (existsSync(cliManifestPath)) {
    const cliManifest = readJson(cliManifestPath);
    assertEqual(
      cliManifest.bin?.["mcp-security-proxy"] === "./dist/main.js",
      "packages/cli/package.json: CLI bin must point at ./dist/main.js"
    );
    assertEqual(
      existsSync(join(packagesDir, "cli", "src", "main.ts")),
      "packages/cli/package.json: src/main.ts must exist for the CLI bin surface"
    );
  } else {
    failures.push("packages/cli/package.json: CLI package is missing");
  }
}

checkPackageSurfaceValidator();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

function readExternalRuntimeDependencyDecisions() {
  if (!existsSync(externalRuntimeDependencyRecordPath)) {
    failures.push("docs/ops/external-runtime-dependencies.json: decision record is missing");
    return new Map();
  }

  const record = readJson(externalRuntimeDependencyRecordPath);
  assertEqual(
    record?.schemaVersion === "msp.external-runtime-dependencies.v1",
    "docs/ops/external-runtime-dependencies.json: schemaVersion must be msp.external-runtime-dependencies.v1"
  );
  assertEqual(
    Array.isArray(record?.dependencies),
    "docs/ops/external-runtime-dependencies.json: dependencies must be an array"
  );

  const decisions = new Map();
  for (const [index, decision] of (record?.dependencies ?? []).entries()) {
    const prefix = `docs/ops/external-runtime-dependencies.json: dependencies[${index}]`;
    const manifestPath = `${decision?.workspacePath}/package.json`;
    const group = decision?.dependencyGroup;
    const name = decision?.packageName;
    const version = decision?.version;
    const evidence = decision?.evidence;

    assertEqual(
      typeof decision?.workspacePath === "string" && /^packages\/[a-z0-9-]+$/u.test(decision.workspacePath),
      `${prefix}.workspacePath must identify one packages/* directory`
    );
    assertEqual(group === "dependencies", `${prefix}.dependencyGroup must be dependencies`);
    assertEqual(typeof name === "string" && name.length > 0, `${prefix}.packageName must be a non-empty package name`);
    assertEqual(
      typeof version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version),
      `${prefix}.version must be an exact semver without a range`
    );
    assertEqual(
      typeof decision?.purpose === "string" && decision.purpose.length > 0,
      `${prefix}.purpose must explain the runtime need`
    );
    assertEqual(
      typeof evidence === "string" && /^docs\/adr\/\d{4}-[a-z0-9-]+\.md$/u.test(evidence),
      `${prefix}.evidence must be a safe ADR path`
    );
    if (typeof evidence === "string") {
      assertEqual(existsSync(join(root, evidence)), `${prefix}.evidence must exist`);
    }

    const key = createExternalRuntimeDependencyDecisionKey(manifestPath, group, name);
    assertEqual(!decisions.has(key), `${prefix} duplicates ${key}`);
    decisions.set(key, { version });
  }
  return decisions;
}

function createExternalRuntimeDependencyDecisionKey(file, group, name) {
  return `${file}|${group}|${name}`;
}

function checkDocumentedPackageSurfaces(path, expectedPackages) {
  const text = readFileSync(join(root, path), "utf8");
  const documentedPackages = [...text.matchAll(/^- `packages\/([^`/]+)`:/gm)]
    .map((match) => match[1])
    .sort((left, right) => left.localeCompare(right));
  checkDocumentedPackageSurfaceNames(path, documentedPackages, expectedPackages);
}

function checkDocumentedPackageSurfaceNames(label, documentedPackages, expectedPackages) {
  assertEqual(
    JSON.stringify(documentedPackages) === JSON.stringify(expectedPackages),
    `${label}: documented package surfaces must match ${expectedPackages.join(", ")}`
  );
}

function checkWorkspacePackageGlobs(path, expectedGlobs) {
  const text = readFileSync(join(root, path), "utf8");
  const document = parseDocument(text, { merge: false, uniqueKeys: true });
  if (document.errors.length > 0) {
    failures.push(`${path}: workspace YAML parse failed`);
    return;
  }
  const value = document.toJS();
  const workspaceGlobs = value?.packages;
  if (!Array.isArray(workspaceGlobs) || workspaceGlobs.some((item) => typeof item !== "string")) {
    failures.push(`${path}: packages must be an array of string workspace globs`);
    return;
  }
  checkWorkspacePackageGlobNames(path, workspaceGlobs, expectedGlobs);
}

function checkWorkspacePackageGlobNames(label, workspaceGlobs, expectedGlobs = expectedWorkspaceGlobs) {
  assertEqual(
    JSON.stringify(workspaceGlobs) === JSON.stringify(expectedGlobs),
    `${label}: workspace package globs must match ${expectedGlobs.join(", ")}`
  );
}

function checkWorkspacePackageDirectoryNames(label, directories, expectedPackages = expectedWorkspacePackages) {
  assertEqual(
    JSON.stringify(directories) === JSON.stringify(expectedPackages),
    `${label}: workspace package directories must match ${expectedPackages.join(", ")}`
  );
}

function checkWorkspacePackageEntrypointReExports(manifestPath) {
  const packageName = relative(packagesDir, manifestPath).split(/[\\/]/)[0];
  const expectedReExports = expectedEntrypointReExports.get(packageName);
  if (!expectedReExports) {
    failures.push(
      `${formatPath(manifestPath)}: package ${packageName} is missing expected entrypoint re-export metadata`
    );
    return;
  }
  const indexPath = join(packagesDir, packageName, "src", "index.ts");
  const text = readFileSync(indexPath, "utf8");
  const actualReExports = [...text.matchAll(/^export \* from "([^"]+)";$/gm)].map((match) => match[1]);
  checkEntrypointReExportNames(formatPath(indexPath), actualReExports, expectedReExports);
}

function checkEntrypointReExportNames(label, actualReExports, expectedReExports) {
  assertEqual(
    JSON.stringify(actualReExports) === JSON.stringify(expectedReExports),
    `${label}: entrypoint re-exports must match ${expectedReExports.join(", ")}`
  );
}

function checkWorkspacePackageDistArtifacts(manifestPath) {
  const packageName = relative(packagesDir, manifestPath).split(/[\\/]/)[0];
  const distDir = join(packagesDir, packageName, "dist");
  if (!existsSync(distDir)) {
    return;
  }
  checkDistArtifactFileNames(
    formatPath(distDir),
    collectFiles(distDir).map((path) => formatPath(path))
  );
}

function checkDistArtifactFileNames(label, fileNames) {
  const testArtifacts = fileNames.filter((name) => /\.(?:test|spec)\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u.test(name));
  if (testArtifacts.length > 0) {
    failures.push(`${label}: dist must not contain emitted test artifacts: ${testArtifacts.join(", ")}`);
  }
}

function collectFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(path));
      continue;
    }
    if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}
