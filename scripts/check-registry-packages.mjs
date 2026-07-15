import { dirname, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  publishablePackages,
  registryUrl,
  runCommand,
  runInstalledPackageConsumerSmoke,
  writeJson
} from "./lib/package-consumer-smoke.mjs";
import { resolveExpectedVersion, validatePublishedMetadata } from "./lib/registry-smoke-contract.mjs";

const root = process.cwd();
let expectedVersion;
try {
  expectedVersion = resolveExpectedVersion(process.argv.slice(2), process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "invalid registry smoke version");
  process.exit(1);
}
const npmCommand = process.platform === "win32" ? process.execPath : "npm";
const npmCommandPrefix =
  process.platform === "win32" ? [join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")] : [];
const tempRoot = mkdtempSync(join(tmpdir(), "mcp-security-proxy-registry-smoke-"));
const consumerRoot = join(tempRoot, "consumer");
const userConfigPath = join(tempRoot, ".npmrc");
const globalConfigPath = join(tempRoot, ".npmrc-global");
const npmEnvironment = {
  NODE_AUTH_TOKEN: "",
  NPM_TOKEN: "",
  NPM_CONFIG_AUDIT: "false",
  NPM_CONFIG_FUND: "false",
  NPM_CONFIG_GLOBALCONFIG: globalConfigPath,
  NPM_CONFIG_REGISTRY: registryUrl,
  NPM_CONFIG_USERCONFIG: userConfigPath
};

try {
  writeFileSync(userConfigPath, "", "utf8");
  writeFileSync(globalConfigPath, "", "utf8");
  const metadata = retry("registry metadata", () => readPublishedMetadata(expectedVersion));
  mkdirSync(consumerRoot, { recursive: true });
  writeJson(join(consumerRoot, "package.json"), {
    name: "mcp-security-proxy-registry-consumer-smoke",
    version: "0.0.0",
    private: true,
    type: "module"
  });

  retry("registry package installation", () => {
    runNpm(
      [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        `--registry=${registryUrl}`,
        ...publishablePackages.map((spec) => `${spec.name}@${expectedVersion}`)
      ],
      consumerRoot
    );
  });
  runInstalledPackageConsumerSmoke({ consumerRoot, root, expectedVersion });

  console.log(
    `registry consumer smoke passed for ${metadata.length} packages at ${expectedVersion} with npm provenance`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "registry consumer smoke failed");
  process.exitCode = 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function readPublishedMetadata(version) {
  return publishablePackages.map((spec) => {
    const result = runNpm(
      ["view", `${spec.name}@${version}`, "version", "dist", "--json", `--registry=${registryUrl}`],
      root
    );
    const metadata = JSON.parse(result.stdout);
    return validatePublishedMetadata(spec, metadata, version, registryUrl);
  });
}

function runNpm(args, cwd) {
  return runCommand(npmCommand, [...npmCommandPrefix, ...args], cwd, npmEnvironment);
}

function retry(label, operation) {
  const delays = [0, 5_000, 10_000, 20_000, 30_000, 30_000];
  let lastError;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) {
      sleep(delays[attempt]);
    }
    try {
      return operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < delays.length) {
        console.warn(`${label} attempt ${attempt + 1} failed; retrying`);
      }
    }
  }
  throw lastError;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
