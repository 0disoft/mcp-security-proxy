import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  publishablePackages as packages,
  registryUrl,
  repositoryUrl,
  runCommand,
  runInstalledPackageConsumerSmoke,
  writeJson
} from "./lib/package-consumer-smoke.mjs";

const root = process.cwd();
const packageManagerCommand = "pnpm";
const npmCommand = process.platform === "win32" ? process.execPath : "npm";
const npmCommandPrefix =
  process.platform === "win32" ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : [];

const tempRoot = mkdtempSync(join(tmpdir(), "mcp-security-proxy-consumer-"));

try {
  const archives = packages.map(packAndInspectPackage);
  const externalArchives = packInstalledExternalDependencyGraph();
  const consumerRoot = join(tempRoot, "consumer");
  mkdirSync(consumerRoot, { recursive: true });
  writeJson(join(consumerRoot, "package.json"), {
    name: "mcp-security-proxy-package-consumer-smoke",
    version: "0.0.0",
    private: true,
    type: "module"
  });

  runCommand(
    npmCommand,
    [
      ...npmCommandPrefix,
      "install",
      "--offline",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      ...archives,
      ...externalArchives
    ],
    consumerRoot,
    {
      NPM_CONFIG_OFFLINE: "true",
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_FUND: "false"
    }
  );

  runInstalledPackageConsumerSmoke({ consumerRoot, root });

  console.log(
    `package consumer smoke passed for ${packages.length} publishable packages and ${externalArchives.length} external dependency packages`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "package consumer smoke failed");
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function packAndInspectPackage(spec) {
  const packDirectory = join(tempRoot, "packs", spec.directory);
  mkdirSync(packDirectory, { recursive: true });
  runCommand(packageManagerCommand, ["--filter", spec.name, "pack", "--pack-destination", packDirectory], root);

  const archives = readdirSync(packDirectory).filter((name) => name.endsWith(".tgz"));
  if (archives.length !== 1) {
    throw new Error(`${spec.name}: expected one package archive, found ${archives.length}`);
  }
  const archivePath = join(packDirectory, archives[0]);
  const entries = readTarEntries(archivePath);
  const entryNames = new Set(entries.keys());
  const requiredFiles = [
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/dist/index.js",
    "package/dist/index.d.ts",
    ...spec.requiredFiles
  ];
  for (const path of requiredFiles) {
    if (!entryNames.has(path)) {
      throw new Error(`${spec.name}: package archive is missing ${path}`);
    }
  }

  for (const path of entryNames) {
    if (!isAllowedArchivePath(path, spec.directory)) {
      throw new Error(`${spec.name}: package archive contains unapproved path ${path}`);
    }
  }

  const manifestBytes = entries.get("package/package.json");
  if (!manifestBytes) {
    throw new Error(`${spec.name}: package archive manifest is missing`);
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assertEqual(manifest.name === spec.name, `${spec.name}: packed manifest name drifted`);
  assertEqual(manifest.types === "./dist/index.d.ts", `${spec.name}: packed types entry must use dist/index.d.ts`);
  assertEqual(
    manifest.exports?.["."]?.types === "./dist/index.d.ts",
    `${spec.name}: packed export types entry drifted`
  );
  assertEqual(manifest.exports?.["."]?.default === "./dist/index.js", `${spec.name}: packed runtime export drifted`);
  assertEqual(manifest.repository?.url === repositoryUrl, `${spec.name}: packed repository URL drifted`);
  assertEqual(manifest.publishConfig?.access === "public", `${spec.name}: packed access must be public`);
  assertEqual(manifest.publishConfig?.registry === registryUrl, `${spec.name}: packed registry must be npmjs.org`);
  assertEqual(
    !JSON.stringify(manifest).includes("workspace:"),
    `${spec.name}: packed manifest retained a workspace protocol`
  );
  for (const [dependencyName, dependencyVersion] of Object.entries(manifest.dependencies ?? {})) {
    if (packages.some((item) => item.name === dependencyName)) {
      assertEqual(
        dependencyVersion === manifest.version,
        `${spec.name}: packed dependency ${dependencyName} must match package version ${manifest.version}`
      );
    }
  }
  return archivePath;
}

function packInstalledExternalDependencyGraph() {
  const decisionRecord = JSON.parse(
    readFileSync(join(root, "docs", "ops", "external-runtime-dependencies.json"), "utf8")
  );
  const queue = decisionRecord.dependencies.map((decision) => ({
    name: decision.packageName,
    requireFrom: createRequire(join(root, decision.workspacePath, "package.json"))
  }));
  const visited = new Set();
  const archives = [];

  while (queue.length > 0) {
    const item = queue.shift();
    const packageRoot = resolveInstalledPackageRoot(item.name, item.requireFrom);
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const packageKey = `${manifest.name}@${manifest.version}`;
    if (visited.has(packageKey)) {
      continue;
    }
    visited.add(packageKey);
    archives.push(packInstalledExternalPackage(packageRoot, manifest));

    const requireFromPackage = createRequire(join(packageRoot, "package.json"));
    for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
      queue.push({ name: dependencyName, requireFrom: requireFromPackage });
    }
    for (const dependencyName of Object.keys(manifest.peerDependencies ?? {})) {
      try {
        requireFromPackage.resolve(dependencyName);
        queue.push({ name: dependencyName, requireFrom: requireFromPackage });
      } catch {
        if (manifest.peerDependenciesMeta?.[dependencyName]?.optional !== true) {
          throw new Error(`${packageKey}: required peer dependency ${dependencyName} is not installed`);
        }
      }
    }
  }
  return archives;
}

function resolveInstalledPackageRoot(name, requireFrom) {
  let current = dirname(requireFrom.resolve(name));
  while (true) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === name) {
        return current;
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`could not locate installed package root for ${name}`);
    }
    current = parent;
  }
}

function packInstalledExternalPackage(packageRoot, manifest) {
  const safeName = manifest.name.replaceAll("@", "").replaceAll("/", "-");
  const packDirectory = join(tempRoot, "packs", "external", `${safeName}-${manifest.version}`);
  mkdirSync(packDirectory, { recursive: true });
  const packResult = runCommand(
    npmCommand,
    [
      ...npmCommandPrefix,
      "pack",
      "--json",
      "--offline",
      "--ignore-scripts",
      "--pack-destination",
      packDirectory,
      packageRoot
    ],
    root,
    { NPM_CONFIG_OFFLINE: "true" }
  );
  const packed = JSON.parse(packResult.stdout);
  if (!Array.isArray(packed) || packed.length !== 1) {
    throw new Error(`${manifest.name}: expected one external npm pack result`);
  }
  const packedManifest = packed[0];
  assertEqual(packedManifest.name === manifest.name, `${manifest.name}: external packed name drifted`);
  assertEqual(
    packedManifest.version === manifest.version,
    `${manifest.name}: external packed version drifted from ${manifest.version}`
  );
  const archivePath = join(packDirectory, packedManifest.filename);
  assertEqual(existsSync(archivePath), `${manifest.name}: external package archive is missing`);
  return archivePath;
}

function isAllowedArchivePath(path, packageDirectory) {
  if (["package/package.json", "package/README.md", "package/LICENSE"].includes(path)) {
    return true;
  }
  if (path.startsWith("package/dist/")) {
    return !/\.(?:test|spec)\.(?:js|js\.map|d\.ts|d\.ts\.map)$/u.test(path);
  }
  return packageDirectory === "contracts" && path.startsWith("package/schemas/") && path.endsWith(".schema.json");
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
    const size = sizeText.length === 0 ? 0 : Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`${path}: invalid tar entry size for ${name || "<unnamed>"}`);
    }
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const dataOffset = offset + 512;
    const type = header[156];
    if (entryPath && (type === 0 || type === 48)) {
      entries.set(entryPath, tar.subarray(dataOffset, dataOffset + size));
    } else if (entryPath && type !== 53) {
      throw new Error(`${path}: unsupported tar entry type ${String.fromCharCode(type)} for ${entryPath}`);
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

function assertEqual(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
