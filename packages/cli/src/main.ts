#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCliAsync } from "./commands.js";
import type { UpstreamCommand, UpstreamProcess } from "@0disoft/mcp-security-proxy-runtime";
import { createUpstreamEnvironment } from "./upstream-environment.js";
import { createProcessTreeTerminator } from "./process-tree.js";
import { establishWindowsKillOnCloseGuardian, WindowsProcessContainmentError } from "./windows-job-guardian.js";
import { spawnPosixGuardedUpstream } from "./posix-process-guardian.js";
import { createPolicyFileReloadSource } from "./policy-file-reloader.js";
import { createOpsFeatureFlagController } from "./ops-feature-flags.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const result = await runCliAsync(argv, {
    readTextFile: (path) => readFileSync(path, "utf8"),
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    clientInput: process.stdin,
    mcpOutput: process.stdout,
    appendTextFile: (path, text) => appendFile(path, text, "utf8"),
    spawnUpstream,
    createPolicyReloadSource: (options) => createPolicyFileReloadSource(options),
    createOpsFeatureFlagController: (options) => createOpsFeatureFlagController(options)
  });
  return result.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runEntrypoint(process.argv.slice(2))
    .then((exitCode) => process.exit(exitCode))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "unhandled CLI failure");
      process.exit(1);
    });
}

interface EntrypointDependencies {
  readonly establishWindowsContainment?: () => Promise<void>;
  readonly runMain?: (argv: string[]) => Promise<number>;
  readonly stderr?: (line: string) => void;
}

export async function runEntrypoint(
  argv: readonly string[],
  dependencies: EntrypointDependencies = {}
): Promise<number> {
  if (argv[0] === "run") {
    try {
      await (dependencies.establishWindowsContainment ?? establishWindowsKillOnCloseGuardian)();
    } catch (error) {
      if (!(error instanceof WindowsProcessContainmentError)) {
        throw error;
      }
      (dependencies.stderr ?? console.error)(error.message);
      return 4;
    }
  }
  return (dependencies.runMain ?? main)([...argv]);
}

function spawnUpstream(
  command: UpstreamCommand,
  context: import("@0disoft/mcp-security-proxy-runtime").UpstreamSpawnContext
): UpstreamProcess {
  const environment = createUpstreamEnvironment(process.env);
  if (process.platform !== "win32") {
    return spawnPosixGuardedUpstream(command, environment, context);
  }

  const child = spawn(command.executable, command.argv, {
    env: environment,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });

  if (!child.stdin || !child.stdout || !child.stderr) {
    child.kill();
    throw new Error("failed to create upstream stdio pipes");
  }

  const terminateProcessTree = createProcessTreeTerminator(child);
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    exit: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    }),
    kill: terminateProcessTree
  };
}
