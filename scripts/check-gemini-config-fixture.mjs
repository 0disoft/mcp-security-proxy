import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { registryUrl, runCommand } from "./lib/package-consumer-smoke.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const geminiPackage = "@google/gemini-cli";
const geminiCorePackage = "@google/gemini-cli-core";
const geminiVersion = "0.50.0";
const serverName = "msp-fixture";
const approvalExtensionName = "gemini-approval-policy";
const approvalExtensionRoot = join(repoRoot, "fixtures", "compatibility", approvalExtensionName);
const summaryPath = "fixtures/compatibility/gemini-cli-config.summary.json";
const update = process.argv.includes("--update");
const tempRoot = mkdtempSync(join(tmpdir(), "msp-gemini-config-"));

try {
  installGemini(tempRoot);
  const actual = await runFixture(tempRoot);
  const expectedPath = join(repoRoot, summaryPath);
  if (update || !existsSync(expectedPath)) {
    writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    process.exit(0);
  }
  const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
  if (stableJson(actual) !== stableJson(expected)) {
    console.error(`${summaryPath}: Gemini CLI configuration fixture drifted`);
    console.error("Run `node scripts/check-gemini-config-fixture.mjs --update` after reviewing the drift.");
    process.exit(1);
  }
  console.log(`Gemini CLI config fixture passed for ${geminiPackage}@${geminiVersion}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function installGemini(cwd) {
  const userConfigPath = join(cwd, ".npmrc");
  const globalConfigPath = join(cwd, ".npmrc-global");
  writeFileSync(userConfigPath, "", "utf8");
  writeFileSync(globalConfigPath, "", "utf8");
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        private: true,
        dependencies: {
          [geminiPackage]: geminiVersion,
          [geminiCorePackage]: geminiVersion
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  const npmCommand = process.platform === "win32" ? process.execPath : "npm";
  const npmCommandPrefix =
    process.platform === "win32" ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : [];
  runCommand(
    npmCommand,
    [
      ...npmCommandPrefix,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `${geminiPackage}@${geminiVersion}`,
      `${geminiCorePackage}@${geminiVersion}`,
      `--registry=${registryUrl}`
    ],
    cwd,
    {
      NODE_AUTH_TOKEN: "",
      NPM_TOKEN: "",
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_FUND: "false",
      NPM_CONFIG_GLOBALCONFIG: globalConfigPath,
      NPM_CONFIG_REGISTRY: registryUrl,
      NPM_CONFIG_USERCONFIG: userConfigPath
    }
  );
}

async function runFixture(cwd) {
  const isolatedHome = join(cwd, "home");
  const workingDirectory = join(cwd, "workspace");
  mkdirSync(isolatedHome, { recursive: true });
  mkdirSync(workingDirectory, { recursive: true });

  const cliEntry = join(repoRoot, "packages", "cli", "dist", "main.js");
  const descriptorResult = runCommand(
    process.execPath,
    [
      cliEntry,
      "config-snippet",
      "--target",
      "gemini-cli-json",
      "--name",
      serverName,
      "--policy",
      "fixtures/policies/local-dev.json",
      "--profile",
      "local",
      "--",
      "fixture server",
      "--root",
      "workspace/public files"
    ],
    repoRoot
  );
  const descriptor = JSON.parse(descriptorResult.stdout);
  const expectedPrefix = ["mcp", "add", "--scope", "project", "--transport", "stdio", serverName, "mcp-security-proxy"];
  if (descriptor.command !== "gemini" || stableJson(descriptor.args?.slice(0, 8)) !== stableJson(expectedPrefix)) {
    throw new Error("Gemini config descriptor must contain the project-scoped stdio registration prefix");
  }

  const geminiEntry = join(cwd, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
  const isolatedEnvironment = {
    APPDATA: join(isolatedHome, "appdata"),
    HOME: isolatedHome,
    LOCALAPPDATA: join(isolatedHome, "local-appdata"),
    USERPROFILE: isolatedHome,
    XDG_CONFIG_HOME: join(isolatedHome, "xdg-config")
  };
  runCommand(process.execPath, [geminiEntry, ...descriptor.args], workingDirectory, isolatedEnvironment);

  const settingsPath = join(workingDirectory, ".gemini", "settings.json");
  if (!existsSync(settingsPath)) {
    throw new Error("Gemini MCP registration did not create project-scoped .gemini/settings.json");
  }
  if (existsSync(join(isolatedHome, ".gemini", "settings.json"))) {
    throw new Error("Gemini project-scoped registration unexpectedly wrote user-scoped settings");
  }
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const observed = settings.mcpServers?.[serverName];
  const expectedProxyArgs = collapseGeminiParserSeparator(descriptor.args.slice(8));
  if (
    observed?.command !== "mcp-security-proxy" ||
    stableJson(observed?.args) !== stableJson(expectedProxyArgs) ||
    Object.keys(settings.mcpServers ?? {}).length !== 1
  ) {
    throw new Error("Gemini MCP registration did not preserve the generated proxy command and argv");
  }
  const extensionManifest = JSON.parse(readFileSync(join(approvalExtensionRoot, "gemini-extension.json"), "utf8"));
  const extensionPolicy = readFileSync(join(approvalExtensionRoot, "policies", "mcp-security-proxy.toml"), "utf8");
  assertApprovalPolicy(extensionManifest, extensionPolicy);
  const approval = await evaluateApprovalPolicy(cwd);

  return {
    schemaVersion: "msp.host-config-fixture.v1",
    target: "gemini-cli-config",
    fixtureSource: "external-host-cli",
    host: {
      package: geminiPackage,
      version: geminiVersion,
      corePackage: geminiCorePackage
    },
    descriptor,
    observed: {
      name: serverName,
      scope: "project",
      transport: {
        type: "stdio",
        command: observed.command,
        args: observed.args
      }
    },
    approval,
    isolation: {
      home: "<temporary-home>",
      settings: "<temporary-working-directory>/.gemini/settings.json",
      workingDirectory: "<temporary-working-directory>"
    }
  };
}

function assertApprovalPolicy(manifest, policy) {
  if (
    manifest?.name !== approvalExtensionName ||
    manifest?.version !== "0.0.0" ||
    Object.keys(manifest).some((key) => !["name", "version", "description"].includes(key))
  ) {
    throw new Error("Gemini approval policy extension manifest drifted");
  }
  for (const phrase of [
    'mcpName = "msp-fixture"',
    'toolName = "*"',
    'decision = "ask_user"',
    "interactive = true",
    'decision = "deny"',
    "interactive = false"
  ]) {
    if (!policy.includes(phrase)) {
      throw new Error("Gemini approval policy extension contract drifted");
    }
  }
  if (/decision\s*=\s*"allow"|modes\s*=|trust\s*=/u.test(policy)) {
    throw new Error("Gemini approval policy extension must not bypass host confirmation");
  }
}

async function evaluateApprovalPolicy(cwd) {
  const geminiRoot = join(cwd, "node_modules", "@google", "gemini-cli");
  const geminiRequire = createRequire(join(geminiRoot, "package.json"));
  let coreEntry;
  try {
    coreEntry = geminiRequire.resolve("@google/gemini-cli-core");
  } catch (error) {
    throw new Error("Gemini CLI core dependency could not be resolved from the pinned host package", {
      cause: error
    });
  }
  const coreRoot = findPackageRoot(coreEntry, "@google/gemini-cli-core");
  const coreManifest = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8"));
  if (coreManifest.name !== geminiCorePackage || coreManifest.version !== geminiVersion) {
    throw new Error(`Gemini CLI core version drifted: ${coreManifest.name}@${coreManifest.version}`);
  }
  const { loadExtensionPolicies, PolicyDecision, PolicyEngine } = await import(pathToFileURL(coreEntry).href);
  const loaded = await loadExtensionPolicies(approvalExtensionName, join(approvalExtensionRoot, "policies"));
  if (loaded.errors.length > 0) {
    throw new Error(`Gemini approval policy was rejected:\n${JSON.stringify(loaded.errors, null, 2)}`);
  }
  if (loaded.rules.length !== 2 || loaded.checkers.length !== 0) {
    throw new Error("Gemini approval policy must load exactly two rules and no safety checkers");
  }

  const toolCall = { name: "mcp_msp-fixture_synthetic-tool", args: {} };
  const interactiveEngine = new PolicyEngine({
    rules: loaded.rules,
    defaultDecision: PolicyDecision.DENY,
    nonInteractive: false
  });
  const nonInteractiveEngine = new PolicyEngine({
    rules: loaded.rules,
    defaultDecision: PolicyDecision.DENY,
    nonInteractive: true
  });
  const interactiveResult = await interactiveEngine.check(toolCall, serverName);
  const nonInteractiveResult = await nonInteractiveEngine.check(toolCall, serverName);
  const otherServerResult = await interactiveEngine.check(toolCall, "other-server");
  if (interactiveResult.decision !== PolicyDecision.ASK_USER) {
    throw new Error(`Gemini interactive policy returned ${interactiveResult.decision}, expected ask_user`);
  }
  if (nonInteractiveResult.decision !== PolicyDecision.DENY) {
    throw new Error(`Gemini non-interactive policy returned ${nonInteractiveResult.decision}, expected deny`);
  }
  if (otherServerResult.decision !== PolicyDecision.DENY) {
    throw new Error("Gemini approval policy matched an unrelated MCP server");
  }

  return {
    source: "gemini-extension-policy",
    extension: approvalExtensionName,
    serverName,
    interactiveDecision: interactiveResult.decision,
    nonInteractiveDecision: nonInteractiveResult.decision,
    unrelatedServerDecision: otherServerResult.decision,
    proxyApprovalHookBridge: false,
    exactCoreLoader: true,
    exactCoreEvaluator: true
  };
}

function findPackageRoot(entryPath, expectedName) {
  let current = dirname(entryPath);
  while (true) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        if (manifest.name === expectedName) {
          return current;
        }
      } catch {
        // Continue toward the filesystem root; a dependency parent may own the entrypoint.
      }
    }
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  throw new Error("Gemini CLI core dependency root could not be identified");
}

function collapseGeminiParserSeparator(args) {
  const separatorIndex = args.findIndex((value, index) => value === "--" && args[index + 1] === "--");
  if (separatorIndex < 0) {
    throw new Error("Gemini descriptor must duplicate the nested separator for its CLI parser");
  }
  return [...args.slice(0, separatorIndex), ...args.slice(separatorIndex + 1)];
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
