import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const releaseRecordsDir = join(root, "docs", "ops", "release-records");
const expectedPublicPackages = [
  "@0disoft/mcp-security-proxy-contracts",
  "@0disoft/mcp-security-proxy-core",
  "@0disoft/mcp-security-proxy-mcp-adapter",
  "@0disoft/mcp-security-proxy-runtime",
  "@0disoft/mcp-security-proxy-cli"
];
const tagName = process.env.GITHUB_REF_NAME ?? process.argv[2] ?? "";
const tagVersionMatch = tagName.match(/^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
const currentHead = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
}).trim();

const failures = [];

if (!tagVersionMatch) {
  failures.push(`release tag must match vMAJOR.MINOR.PATCH[-PRERELEASE], got ${tagName || "<missing>"}`);
} else {
  const releaseVersion = tagVersionMatch[1];
  const releaseEntry = findApprovedReleaseRecord(releaseVersion);
  if (releaseEntry) {
    checkReleaseRecord(releaseEntry.record, releaseVersion, releaseEntry.path);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log(`release publish plan ok for ${tagName}`);

function findApprovedReleaseRecord(releaseVersion) {
  if (!existsSync(releaseRecordsDir)) {
    failures.push("docs/ops/release-records is missing");
    return undefined;
  }
  const records = readdirSync(releaseRecordsDir)
    .filter((name) => name.endsWith(".release.json"))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ path: join(releaseRecordsDir, name), record: readJson(join(releaseRecordsDir, name)) }));
  const matches = records.filter((entry) => entry.record.status === "approved" && entry.record.releaseVersion === releaseVersion);
  if (matches.length === 0) {
    failures.push(`no approved release record found for ${releaseVersion}`);
    return undefined;
  }
  if (matches.length > 1) {
    failures.push(`multiple approved release records found for ${releaseVersion}`);
    return undefined;
  }
  return matches[0];
}

function checkReleaseRecord(record, releaseVersion, recordPath) {
  if (!isReachableCommit(record.targetCommit)) {
    failures.push(`release record targetCommit must be reachable from current HEAD: ${record.targetCommit || "<missing>"}`);
  } else {
    checkChangesAfterApprovedTarget(record.targetCommit, recordPath);
  }
  if (!String(record.registryTarget ?? "").includes("npmjs.org")) {
    failures.push("release record registryTarget must name npmjs.org");
  }
  const owner = String(record.publishCredentialsOwner ?? "");
  if (!owner || /\bblocked\b|no publish credential use approved/i.test(owner)) {
    failures.push("release record publishCredentialsOwner must approve npm Trusted Publisher ownership");
  }
  const publicPackages = Array.isArray(record.publicPackages) ? record.publicPackages : [];
  const packageNames = publicPackages.map((item) => item?.name).filter(Boolean).sort((left, right) => left.localeCompare(right));
  const expectedNames = [...expectedPublicPackages].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(packageNames) !== JSON.stringify(expectedNames)) {
    failures.push(`release record publicPackages must match ${expectedNames.join(", ")}`);
  }
  for (const item of publicPackages) {
    if (!item || typeof item !== "object" || typeof item.workspacePath !== "string") {
      failures.push("release record publicPackages entries must include workspacePath");
      continue;
    }
    checkPackageManifest(item, releaseVersion);
  }
}

function checkChangesAfterApprovedTarget(targetCommit, recordPath) {
  const changedPaths = execFileSync("git", ["diff", "--name-only", `${targetCommit}..${currentHead}`], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
  const allowedPath = recordPath.slice(root.length + 1).replaceAll("\\", "/");
  const unexpectedPaths = changedPaths.filter((path) => path !== allowedPath);
  if (unexpectedPaths.length > 0) {
    failures.push(
      `release tag contains changes after targetCommit outside its approval record: ${unexpectedPaths.join(", ")}`
    );
  }
}

function checkPackageManifest(item, releaseVersion) {
  const manifestPath = join(root, item.workspacePath, "package.json");
  if (!existsSync(manifestPath)) {
    failures.push(`${item.workspacePath}/package.json is missing`);
    return;
  }
  const manifest = readJson(manifestPath);
  if (manifest.name !== item.name) {
    failures.push(`${item.workspacePath}/package.json name must match release record package name ${item.name}`);
  }
  if (manifest.version !== releaseVersion) {
    failures.push(`${item.workspacePath}/package.json version must be ${releaseVersion}`);
  }
  if (manifest.private === true) {
    failures.push(`${item.workspacePath}/package.json private must be removed or false before publish`);
  }
}

function isReachableCommit(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) {
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

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
