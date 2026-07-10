import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

const root = process.cwd();
const packageManagerCommand = "pnpm";
const npmCommand = process.platform === "win32" ? process.execPath : "npm";
const npmCommandPrefix = process.platform === "win32"
  ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")]
  : [];
const registryUrl = "https://registry.npmjs.org";
const repositoryUrl = "https://github.com/0disoft/mcp-security-proxy.git";
const nodeTypeRoots = join(root, "node_modules", "@types");
const packages = [
  {
    name: "@0disoft/mcp-security-proxy-contracts",
    directory: "contracts",
    requiredFiles: [
      "package/schemas/audit-event.v1.schema.json",
      "package/schemas/decision.v1.schema.json",
      "package/schemas/ops-event.v1.schema.json",
      "package/schemas/policy.v1.schema.json"
    ]
  },
  {
    name: "@0disoft/mcp-security-proxy-core",
    directory: "core",
    requiredFiles: []
  },
  {
    name: "@0disoft/mcp-security-proxy-mcp-adapter",
    directory: "mcp-adapter",
    requiredFiles: []
  },
  {
    name: "@0disoft/mcp-security-proxy-runtime",
    directory: "proxy-runtime",
    requiredFiles: []
  },
  {
    name: "@0disoft/mcp-security-proxy-cli",
    directory: "cli",
    requiredFiles: ["package/dist/main.js"]
  }
];

const tempRoot = mkdtempSync(join(tmpdir(), "mcp-security-proxy-consumer-"));

try {
  const archives = packages.map(packAndInspectPackage);
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
      ...archives
    ],
    consumerRoot,
    {
      NPM_CONFIG_OFFLINE: "true",
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_FUND: "false"
    }
  );

  writeFileSync(join(consumerRoot, "consumer.mjs"), createJavascriptConsumerSource(), "utf8");
  writeFileSync(join(consumerRoot, "consumer.ts"), createTypescriptConsumerSource(), "utf8");
  writeJson(join(consumerRoot, "tsconfig.json"), {
    compilerOptions: {
      target: "ES2024",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: ["node"],
      typeRoots: [nodeTypeRoots]
    },
    include: ["consumer.ts"]
  });

  runCommand(process.execPath, [join(consumerRoot, "consumer.mjs")], consumerRoot);
  if (!existsSync(join(nodeTypeRoots, "node"))) {
    throw new Error("workspace Node type baseline is missing from node_modules/@types/node");
  }
  runCommand(
    process.execPath,
    [join(root, "node_modules", "typescript", "bin", "tsc"), "--project", join(consumerRoot, "tsconfig.json")],
    consumerRoot
  );

  const cliResult = runCommand(
    process.execPath,
    [join(consumerRoot, "node_modules", "@0disoft", "mcp-security-proxy-cli", "dist", "main.js"), "--help"],
    consumerRoot
  );
  if (!cliResult.stdout.includes("Usage: mcp-security-proxy <command> [options]")) {
    throw new Error("installed CLI help did not expose the expected command usage");
  }

  console.log(`package consumer smoke passed for ${packages.length} publishable packages`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "package consumer smoke failed");
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function packAndInspectPackage(spec) {
  const packDirectory = join(tempRoot, "packs", spec.directory);
  mkdirSync(packDirectory, { recursive: true });
  runCommand(
    packageManagerCommand,
    ["--filter", spec.name, "pack", "--pack-destination", packDirectory],
    root
  );

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
  assertEqual(manifest.exports?.["."]?.types === "./dist/index.d.ts", `${spec.name}: packed export types entry drifted`);
  assertEqual(manifest.exports?.["."]?.default === "./dist/index.js", `${spec.name}: packed runtime export drifted`);
  assertEqual(manifest.repository?.url === repositoryUrl, `${spec.name}: packed repository URL drifted`);
  assertEqual(manifest.publishConfig?.access === "public", `${spec.name}: packed access must be public`);
  assertEqual(manifest.publishConfig?.registry === registryUrl, `${spec.name}: packed registry must be npmjs.org`);
  assertEqual(!JSON.stringify(manifest).includes("workspace:"), `${spec.name}: packed manifest retained a workspace protocol`);
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

function runCommand(command, args, cwd, extraEnvironment = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnvironment
    },
    windowsHide: true
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

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertEqual(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createJavascriptConsumerSource() {
  return `import { knownSchemaVersions } from "@0disoft/mcp-security-proxy-contracts";
import { classifyToolDescriptor } from "@0disoft/mcp-security-proxy-core";
import { normalizeToolCallEnvelope } from "@0disoft/mcp-security-proxy-mcp-adapter";
import { createProxySession } from "@0disoft/mcp-security-proxy-runtime";
import { createCommandRegistry } from "@0disoft/mcp-security-proxy-cli";

for (const value of [knownSchemaVersions, classifyToolDescriptor, normalizeToolCallEnvelope, createProxySession, createCommandRegistry]) {
  if (typeof value !== "function") {
    throw new Error("installed package export is not callable");
  }
}
if (createCommandRegistry().length !== 4) {
  throw new Error("installed CLI command registry drifted");
}
`;
}

function createTypescriptConsumerSource() {
  return `import { knownSchemaVersions, type PolicyDocument } from "@0disoft/mcp-security-proxy-contracts";
import { classifyToolDescriptor } from "@0disoft/mcp-security-proxy-core";
import { normalizeToolCallEnvelope } from "@0disoft/mcp-security-proxy-mcp-adapter";
import { createProxySession } from "@0disoft/mcp-security-proxy-runtime";
import { createCommandRegistry } from "@0disoft/mcp-security-proxy-cli";

declare const policy: PolicyDocument;
void policy;
void knownSchemaVersions;
void classifyToolDescriptor;
void normalizeToolCallEnvelope;
void createProxySession;
void createCommandRegistry;
`;
}
