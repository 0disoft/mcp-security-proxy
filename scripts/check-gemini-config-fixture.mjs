import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { registryUrl, runCommand } from "./lib/package-consumer-smoke.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const geminiPackage = "@google/gemini-cli";
const geminiVersion = "0.50.0";
const serverName = "msp-fixture";
const summaryPath = "fixtures/compatibility/gemini-cli-config.summary.json";
const update = process.argv.includes("--update");
const tempRoot = mkdtempSync(join(tmpdir(), "msp-gemini-config-"));

try {
  installGemini(tempRoot);
  const actual = runFixture(tempRoot);
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
    `${JSON.stringify({ private: true, dependencies: { [geminiPackage]: geminiVersion } }, null, 2)}\n`,
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

function runFixture(cwd) {
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

  return {
    schemaVersion: "msp.host-config-fixture.v1",
    target: "gemini-cli-config",
    fixtureSource: "external-host-cli",
    host: {
      package: geminiPackage,
      version: geminiVersion
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
    isolation: {
      home: "<temporary-home>",
      settings: "<temporary-working-directory>/.gemini/settings.json",
      workingDirectory: "<temporary-working-directory>"
    }
  };
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
