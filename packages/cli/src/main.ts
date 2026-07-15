#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCliAsync } from "./commands.js";
import type { UpstreamCommand, UpstreamProcess } from "@0disoft/mcp-security-proxy-runtime";
import { createUpstreamEnvironment } from "./upstream-environment.js";
import { createProcessTreeTerminator, shouldCreateProcessGroup } from "./process-tree.js";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const result = await runCliAsync(argv, {
    readTextFile: (path) => readFileSync(path, "utf8"),
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    clientInput: process.stdin,
    mcpOutput: process.stdout,
    appendTextFile: (path, text) => appendFile(path, text, "utf8"),
    spawnUpstream
  });
  return result.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((exitCode) => process.exit(exitCode))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "unhandled CLI failure");
      process.exit(1);
    });
}

function spawnUpstream(command: UpstreamCommand): UpstreamProcess {
  const child = spawn(command.executable, command.argv, {
    env: createUpstreamEnvironment(process.env),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: shouldCreateProcessGroup()
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
