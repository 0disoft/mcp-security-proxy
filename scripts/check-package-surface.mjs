import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const expectedNodeEngine = ">=24.0.0";
const expectedLicense = "Apache-2.0";
const expectedWorkspacePackages = [
  "cli",
  "contracts",
  "core",
  "mcp-adapter",
  "proxy-runtime",
  "testkit"
];
const dependencyGroups = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const mcpSdkDependencyPatterns = [
  /^@modelcontextprotocol\/sdk$/,
  /\bmcp-sdk\b/i,
  /\bmodelcontextprotocol\b/i
];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const formatPath = (path) => relative(root, path).replaceAll("\\", "/");

const failures = [];

const assertEqual = (condition, message) => {
  if (!condition) {
    failures.push(message);
  }
};

const checkCommonManifest = (manifest, manifestPath) => {
  const file = formatPath(manifestPath);
  assertEqual(manifest.private === true, `${file}: private must stay true before public release`);
  assertEqual(manifest.type === "module", `${file}: type must be module`);
  assertEqual(manifest.license === expectedLicense, `${file}: license must be ${expectedLicense}`);
  assertEqual(manifest.engines?.node === expectedNodeEngine, `${file}: engines.node must be ${expectedNodeEngine}`);
};

const checkWorkspacePackage = (manifest, manifestPath) => {
  const file = formatPath(manifestPath);
  const packageRoot = manifestPath.slice(0, -"package.json".length);
  checkCommonManifest(manifest, manifestPath);
  assertEqual(manifest.version === "0.0.0", `${file}: version must stay 0.0.0 until release readiness records a public version`);
  assertEqual(typeof manifest.name === "string" && manifest.name.startsWith("@0disoft/mcp-security-proxy-"), `${file}: package name must stay under @0disoft/mcp-security-proxy-*`);
  assertEqual(manifest.types === "./src/index.ts", `${file}: types must point at ./src/index.ts`);
  assertEqual(manifest.exports?.["."]?.types === "./src/index.ts", `${file}: exports[.].types must point at ./src/index.ts`);
  assertEqual(manifest.exports?.["."]?.default === "./dist/index.js", `${file}: exports[.].default must point at ./dist/index.js`);
  assertEqual(existsSync(join(packageRoot, "src", "index.ts")), `${file}: src/index.ts must exist for the exported type surface`);
  assertEqual(existsSync(join(packageRoot, "tsconfig.json")), `${file}: tsconfig.json must exist for package build/typecheck ownership`);
  assertEqual(manifest.scripts?.build === "tsc -p tsconfig.json", `${file}: build script must use tsc -p tsconfig.json`);
  assertEqual(manifest.scripts?.typecheck === "tsc -p tsconfig.json --noEmit", `${file}: typecheck script must use tsc -p tsconfig.json --noEmit`);
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
        failures.push(`${file}: ${group}.${name} must not introduce external runtime dependencies before release readiness records them`);
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

const checkMcpSdkDependency = (name, file, group) => {
  if (mcpSdkDependencyPatterns.some((pattern) => pattern.test(name))) {
    failures.push(`${file}: ${group}.${name} must wait for an ADR or release-readiness record because MCP SDK choices are UNDECIDED`);
  }
};

const checkPackageSurfaceValidator = () => {
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
  if (!sdkDependencyFailures.some((item) => item.includes("MCP SDK choices are UNDECIDED"))) {
    failures.push(`package-surface self-test MCP SDK dependency was not rejected: ${sdkDependencyFailures.join("; ")}`);
  }
};

const collectPackageSurfaceFailures = (fn) => {
  const before = failures.length;
  fn();
  return failures.splice(before);
};

const rootManifestPath = join(root, "package.json");
const rootManifest = readJson(rootManifestPath);
checkCommonManifest(rootManifest, rootManifestPath);
assertEqual(rootManifest.name === "mcp-security-proxy-workspace", "package.json: workspace package name changed unexpectedly");
assertEqual(rootManifest.version === "0.0.0", "package.json: workspace version must stay 0.0.0 before public release");
checkDependencyDecisionGuards(rootManifest, "package.json");

const packagesDir = join(root, "packages");
assertEqual(existsSync(packagesDir), "packages/: workspace packages directory is missing");

if (existsSync(packagesDir)) {
  const packageManifestPaths = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, "package.json"))
    .filter((path) => existsSync(path))
    .sort((left, right) => left.localeCompare(right));

  assertEqual(packageManifestPaths.length > 0, "packages/: no package manifests found");

  const actualWorkspacePackages = packageManifestPaths
    .map((path) => relative(packagesDir, path).split(/[\\/]/)[0])
    .sort((left, right) => left.localeCompare(right));
  assertEqual(JSON.stringify(actualWorkspacePackages) === JSON.stringify(expectedWorkspacePackages), `packages/: expected workspace packages ${expectedWorkspacePackages.join(", ")}, got ${actualWorkspacePackages.join(", ")}`);

  const workspacePackageNames = new Set(packageManifestPaths.map((path) => readJson(path).name));

  for (const manifestPath of packageManifestPaths) {
    const manifest = readJson(manifestPath);
    checkWorkspacePackage(manifest, manifestPath);
    checkDependencies(manifest, manifestPath, workspacePackageNames);
  }

  const cliManifestPath = join(packagesDir, "cli", "package.json");
  if (existsSync(cliManifestPath)) {
    const cliManifest = readJson(cliManifestPath);
    assertEqual(cliManifest.bin?.["mcp-security-proxy"] === "./dist/main.js", "packages/cli/package.json: CLI bin must point at ./dist/main.js");
    assertEqual(existsSync(join(packagesDir, "cli", "src", "main.ts")), "packages/cli/package.json: src/main.ts must exist for the CLI bin surface");
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
