import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

const root = process.cwd();
const planPath = "docs/ops/npm-bootstrap-plan.json";
const writeRequested = process.argv.includes("--write");
const allowedArgs = new Set(["--dry-run", "--write"]);
const unknownArgs = process.argv.slice(2).filter((arg) => !allowedArgs.has(arg));

if (unknownArgs.length > 0 || (process.argv.includes("--dry-run") && writeRequested)) {
  console.error("usage: node scripts/prepare-npm-bootstrap-artifacts.mjs [--dry-run|--write]");
  process.exit(2);
}

const plan = readJson(join(root, planPath));
const outputRoot = writeRequested
  ? resolve(root, plan.artifactDirectory)
  : mkdtempSync(join(tmpdir(), "mcp-security-proxy-bootstrap-"));
const shouldCleanup = !writeRequested;

try {
  checkPreparationGate();
  prepareOutputDirectory();
  runCommand("pnpm", ["build"], root);

  const artifactsDirectory = join(outputRoot, "artifacts");
  const stagingDirectory = join(outputRoot, "staging");
  mkdirSync(artifactsDirectory, { recursive: true });
  mkdirSync(stagingDirectory, { recursive: true });

  const artifacts = [];
  for (const item of plan.packages) {
    const packageDirectory = item.workspacePath.split("/").at(-1);
    const sourceDirectory = join(root, item.workspacePath);
    const stageDirectory = join(stagingDirectory, packageDirectory);
    mkdirSync(stageDirectory, { recursive: true });

    copyRequiredPath(join(sourceDirectory, "dist"), join(stageDirectory, "dist"));
    copyRequiredPath(join(sourceDirectory, "README.md"), join(stageDirectory, "README.md"));
    copyRequiredPath(join(root, "LICENSE"), join(stageDirectory, "LICENSE"));
    if (packageDirectory === "contracts") {
      copyRequiredPath(join(sourceDirectory, "schemas"), join(stageDirectory, "schemas"));
    }

    const sourceManifest = readJson(join(sourceDirectory, "package.json"));
    const stagedManifest = createBootstrapManifest(sourceManifest);
    writeFileSync(join(stageDirectory, "package.json"), `${JSON.stringify(stagedManifest, null, 2)}\n`, "utf8");

    const before = new Set(readdirSync(artifactsDirectory));
    runNpm(["pack", stageDirectory, "--ignore-scripts", "--pack-destination", artifactsDirectory]);
    const created = readdirSync(artifactsDirectory).filter((name) => name.endsWith(".tgz") && !before.has(name));
    if (created.length !== 1) {
      throw new Error(`${item.name}: expected one bootstrap tarball, found ${created.length}`);
    }
    const archivePath = join(artifactsDirectory, created[0]);
    validateArchive(item, archivePath);
    artifacts.push({
      package: item.name,
      version: plan.bootstrapVersion,
      distTag: plan.distTag,
      file: `artifacts/${created[0]}`,
      sha256: sha256(archivePath)
    });
  }

  const sourceCommit = runGit(["rev-parse", "HEAD"]).trim();
  writeFileSync(
    join(outputRoot, "manifest.json"),
    `${JSON.stringify({
      schemaVersion: "msp.npm-bootstrap-artifacts.v1",
      sourceCommit,
      registry: plan.registry,
      credentialIncluded: false,
      firstPublishLatestTagRemovalRequired: true,
      artifacts
    }, null, 2)}\n`,
    "utf8"
  );

  console.log(
    writeRequested
      ? `npm bootstrap artifacts prepared at ${plan.artifactDirectory}`
      : `npm bootstrap artifact dry-run passed for ${artifacts.length} packages`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "npm bootstrap artifact preparation failed");
  process.exitCode = 1;
} finally {
  if (shouldCleanup) {
    rmSync(outputRoot, { recursive: true, force: true });
  }
}

function checkPreparationGate() {
  runCommand(process.execPath, [join(root, "scripts", "check-npm-bootstrap-plan.mjs")], root);
  if (plan.schemaVersion !== "msp.npm-bootstrap.v1") {
    throw new Error(`${planPath}: unsupported schemaVersion`);
  }
  if (plan.bootstrapVersion !== "0.0.0-bootstrap.0" || plan.distTag !== "bootstrap") {
    throw new Error(`${planPath}: bootstrap version and dist-tag are not safe`);
  }
  if (!writeRequested) {
    return;
  }
  if (plan.status !== "approved") {
    throw new Error(`${planPath}: --write requires status approved`);
  }
  if (plan.approval?.approvedBy !== plan.registryOwner || !isFullCommitSha(plan.approval?.sourceCommit)) {
    throw new Error(`${planPath}: --write requires registry-owner approval and a full source commit`);
  }
  if (runGit(["status", "--porcelain"]).trim()) {
    throw new Error("--write requires a clean Git worktree");
  }
  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", plan.approval.sourceCommit, "HEAD"], {
    cwd: root,
    stdio: "ignore",
    windowsHide: true
  });
  if (ancestry.status !== 0) {
    throw new Error(`${planPath}: approval sourceCommit must be reachable from HEAD`);
  }
  const changedSinceApproval = runGit(["diff", "--name-only", `${plan.approval.sourceCommit}..HEAD`])
    .split(/\r?\n/)
    .filter(Boolean);
  if (changedSinceApproval.some((path) => path !== planPath)) {
    throw new Error(`${planPath}: only the bootstrap plan may change after approval sourceCommit`);
  }
}

function prepareOutputDirectory() {
  if (!writeRequested) {
    return;
  }
  const allowedRoot = `${resolve(root, ".tmp")}${sep}`;
  if (!`${outputRoot}${sep}`.startsWith(allowedRoot)) {
    throw new Error(`refusing bootstrap output outside .tmp: ${outputRoot}`);
  }
  if (existsSync(outputRoot)) {
    if (lstatSync(outputRoot).isSymbolicLink()) {
      throw new Error(`refusing to replace symlinked bootstrap output: ${outputRoot}`);
    }
    rmSync(outputRoot, { recursive: true, force: true });
  }
  mkdirSync(outputRoot, { recursive: true });
}

function createBootstrapManifest(sourceManifest) {
  const manifest = structuredClone(sourceManifest);
  manifest.version = plan.bootstrapVersion;
  delete manifest.private;
  for (const group of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, version] of Object.entries(manifest[group] ?? {})) {
      if (typeof version === "string" && version.startsWith("workspace:")) {
        manifest[group][name] = plan.bootstrapVersion;
      }
    }
  }
  return manifest;
}

function validateArchive(item, archivePath) {
  const entries = readTarEntries(archivePath);
  for (const required of ["package/package.json", "package/README.md", "package/LICENSE", "package/dist/index.js", "package/dist/index.d.ts"]) {
    if (!entries.has(required)) {
      throw new Error(`${item.name}: bootstrap tarball is missing ${required}`);
    }
  }
  const packedManifest = JSON.parse(entries.get("package/package.json").toString("utf8"));
  if (
    packedManifest.name !== item.name ||
    packedManifest.version !== plan.bootstrapVersion ||
    packedManifest.private === true ||
    JSON.stringify(packedManifest).includes("workspace:")
  ) {
    throw new Error(`${item.name}: bootstrap tarball manifest did not receive the safe staging transform`);
  }
  for (const path of entries.keys()) {
    const allowed =
      ["package/package.json", "package/README.md", "package/LICENSE"].includes(path) ||
      path.startsWith("package/dist/") ||
      (item.workspacePath === "packages/contracts" && path.startsWith("package/schemas/") && path.endsWith(".schema.json"));
    if (!allowed || /\/(?:src|node_modules)\//.test(path) || /\.(?:test|spec)\./.test(path)) {
      throw new Error(`${item.name}: bootstrap tarball contains unapproved path ${path}`);
    }
  }
}

function readTarEntries(path) {
  const tar = gunzipSync(readFileSync(path));
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const sizeText = readTarString(header, 124, 12).trim();
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`${path}: invalid tar entry size`);
    }
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const dataOffset = offset + 512;
    const type = header[156];
    if (entryPath && (type === 0 || type === 48)) {
      entries.set(entryPath, tar.subarray(dataOffset, dataOffset + size));
    } else if (entryPath && type !== 53) {
      throw new Error(`${path}: unsupported tar entry type for ${entryPath}`);
    }
    offset = dataOffset + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function readTarString(buffer, start, length) {
  const end = buffer.indexOf(0, start);
  const boundedEnd = end === -1 || end > start + length ? start + length : end;
  return buffer.toString("utf8", start, boundedEnd);
}

function copyRequiredPath(source, destination) {
  if (!existsSync(source)) {
    throw new Error(`bootstrap source path is missing: ${source}`);
  }
  cpSync(source, destination, { recursive: true, dereference: false, errorOnExist: true });
}

function runNpm(args) {
  const command = process.platform === "win32" ? process.execPath : "npm";
  const prefix = process.platform === "win32"
    ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")]
    : [];
  runCommand(command, [...prefix, ...args], root);
}

function runGit(args) {
  return runCommand("git", args, root).stdout;
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_FUND: "false"
    }
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}${details ? `\n${details}` : ""}`);
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isFullCommitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
