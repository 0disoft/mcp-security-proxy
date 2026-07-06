#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runCli } from "./commands.js";

export function main(argv = process.argv.slice(2)): number {
  const result = runCli(argv, {
    readTextFile: (path) => readFileSync(path, "utf8"),
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line)
  });
  return result.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
