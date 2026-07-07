import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const expectedNodeEngine = ">=24.0.0";
const expectedLicense = "Apache-2.0";

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
  checkCommonManifest(manifest, manifestPath);
  assertEqual(manifest.version === "0.0.0", `${file}: version must stay 0.0.0 until release readiness records a public version`);
  assertEqual(typeof manifest.name === "string" && manifest.name.startsWith("@0disoft/mcp-security-proxy-"), `${file}: package name must stay under @0disoft/mcp-security-proxy-*`);
  assertEqual(manifest.types === "./src/index.ts", `${file}: types must point at ./src/index.ts`);
  assertEqual(manifest.exports?.["."]?.types === "./src/index.ts", `${file}: exports[.].types must point at ./src/index.ts`);
  assertEqual(manifest.exports?.["."]?.default === "./dist/index.js", `${file}: exports[.].default must point at ./dist/index.js`);
};

const rootManifestPath = join(root, "package.json");
const rootManifest = readJson(rootManifestPath);
checkCommonManifest(rootManifest, rootManifestPath);
assertEqual(rootManifest.name === "mcp-security-proxy-workspace", "package.json: workspace package name changed unexpectedly");
assertEqual(rootManifest.version === "0.0.0", "package.json: workspace version must stay 0.0.0 before public release");

const packagesDir = join(root, "packages");
assertEqual(existsSync(packagesDir), "packages/: workspace packages directory is missing");

if (existsSync(packagesDir)) {
  const packageManifestPaths = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name, "package.json"))
    .filter((path) => existsSync(path))
    .sort((left, right) => left.localeCompare(right));

  assertEqual(packageManifestPaths.length > 0, "packages/: no package manifests found");

  for (const manifestPath of packageManifestPaths) {
    const manifest = readJson(manifestPath);
    checkWorkspacePackage(manifest, manifestPath);
  }

  const cliManifestPath = join(packagesDir, "cli", "package.json");
  if (existsSync(cliManifestPath)) {
    const cliManifest = readJson(cliManifestPath);
    assertEqual(cliManifest.bin?.["mcp-security-proxy"] === "./dist/main.js", "packages/cli/package.json: CLI bin must point at ./dist/main.js");
  } else {
    failures.push("packages/cli/package.json: CLI package is missing");
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}
