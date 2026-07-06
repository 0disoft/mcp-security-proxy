#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCliAsync, type CliRunIo } from "./commands.js";
import type { UpstreamCommand, UpstreamProcess } from "@0disoft/mcp-security-proxy-runtime";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const result = await runCliAsync(argv, {
    readTextFile: (path) => readFileSync(path, "utf8"),
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    clientInput: process.stdin,
    mcpOutput: process.stdout,
    appendTextFile: (path, text) => appendFileSync(path, text, "utf8"),
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
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true
  });

  if (!child.stdin || !child.stdout) {
    child.kill();
    throw new Error("failed to create upstream stdio pipes");
  }

  return {
    stdin: child.stdin,
    stdout: child.stdout,
    exit: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    }),
    kill: () => {
      child.kill();
    }
  };
}
