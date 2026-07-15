import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { registryUrl, runCommand } from "./lib/package-consumer-smoke.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const codexPackage = "@openai/codex";
const codexVersion = "0.144.4";
const serverName = "msp-fixture";
const summaryPath = "fixtures/compatibility/codex-cli-config.summary.json";
const update = process.argv.includes("--update");
const tempRoot = mkdtempSync(join(tmpdir(), "msp-codex-config-"));

try {
  installCodex(tempRoot);
  const actual = runFixture(tempRoot);
  const expectedPath = join(repoRoot, summaryPath);
  if (update || !existsSync(expectedPath)) {
    writeFileSync(expectedPath, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
    process.exit(0);
  }
  const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
  if (stableJson(actual) !== stableJson(expected)) {
    console.error(`${summaryPath}: Codex CLI configuration fixture drifted`);
    console.error("Run `node scripts/check-codex-config-fixture.mjs --update` after reviewing the drift.");
    process.exit(1);
  }
  console.log(`Codex CLI config fixture passed for ${codexPackage}@${codexVersion}`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function installCodex(cwd) {
  const userConfigPath = join(cwd, ".npmrc");
  const globalConfigPath = join(cwd, ".npmrc-global");
  writeFileSync(userConfigPath, "", "utf8");
  writeFileSync(globalConfigPath, "", "utf8");
  writeFileSync(
    join(cwd, "package.json"),
    `${JSON.stringify({ private: true, dependencies: { [codexPackage]: codexVersion } }, null, 2)}\n`,
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
      `${codexPackage}@${codexVersion}`,
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
  const codexHome = join(cwd, "codex-home");
  mkdirSync(codexHome, { recursive: true });
  const cliEntry = join(repoRoot, "packages", "cli", "dist", "main.js");
  const descriptorResult = runCommand(
    process.execPath,
    [
      cliEntry,
      "config-snippet",
      "--target",
      "codex-cli-json",
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
  if (descriptor.command !== "codex" || !Array.isArray(descriptor.args)) {
    throw new Error("Codex config descriptor must contain the codex command and argv array");
  }

  const codexEntry = join(cwd, "node_modules", "@openai", "codex", "bin", "codex.js");
  const isolatedEnvironment = {
    CODEX_HOME: codexHome,
    CODEX_SQLITE_HOME: codexHome
  };
  runCommand(process.execPath, [codexEntry, ...descriptor.args], cwd, isolatedEnvironment);
  const getResult = runCommand(
    process.execPath,
    [codexEntry, "mcp", "get", serverName, "--json"],
    cwd,
    isolatedEnvironment
  );
  const observed = JSON.parse(getResult.stdout);
  const expectedProxyArgs = descriptor.args.slice(5);
  if (
    observed.name !== serverName ||
    observed.transport?.type !== "stdio" ||
    observed.transport?.command !== descriptor.args[4] ||
    stableJson(observed.transport?.args) !== stableJson(expectedProxyArgs)
  ) {
    throw new Error("Codex MCP registration did not preserve the generated proxy command and argv");
  }
  if (!existsSync(join(codexHome, "config.toml"))) {
    throw new Error("Codex MCP registration did not create config.toml in the isolated CODEX_HOME");
  }

  return {
    schemaVersion: "msp.host-config-fixture.v1",
    target: "codex-cli-config",
    fixtureSource: "external-host-cli",
    host: {
      package: codexPackage,
      version: codexVersion
    },
    descriptor,
    observed: {
      name: observed.name,
      enabled: observed.enabled,
      transport: {
        type: observed.transport.type,
        command: observed.transport.command,
        args: observed.transport.args,
        env: observed.transport.env,
        envVars: observed.transport.env_vars,
        cwd: observed.transport.cwd
      }
    },
    isolation: {
      codexHome: "<temporary-codex-home>",
      workingDirectory: "<temporary-working-directory>"
    }
  };
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
