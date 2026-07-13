import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const registryUrl = "https://registry.npmjs.org";
export const repositoryUrl = "https://github.com/0disoft/mcp-security-proxy.git";
export const publishablePackages = [
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

export function runInstalledPackageConsumerSmoke({ consumerRoot, root, expectedVersion }) {
  const nodeTypeRoots = join(root, "node_modules", "@types");
  for (const spec of publishablePackages) {
    const manifestPath = join(consumerRoot, "node_modules", ...spec.name.split("/"), "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (expectedVersion && manifest.version !== expectedVersion) {
      throw new Error(`${spec.name}: installed ${manifest.version || "<missing>"}, expected ${expectedVersion}`);
    }
    if (JSON.stringify(manifest).includes("workspace:")) {
      throw new Error(`${spec.name}: installed manifest retained a workspace protocol`);
    }
  }

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
}

export function runCommand(command, args, cwd, extraEnvironment = {}) {
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

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
