#!/usr/bin/env node
import { createCommandRegistry } from "./commands.js";

const registry = createCommandRegistry();
const commandNames = registry.map((command) => command.name).join(", ");

if (process.argv.includes("--help") || process.argv.length <= 2) {
  console.log(`mcp-security-proxy commands: ${commandNames}`);
  process.exit(0);
}

const commandName = process.argv[2];
const command = registry.find((item) => item.name === commandName);

if (!command) {
  console.error(`unknown command: ${commandName}`);
  process.exit(2);
}

console.log(`${command.name}: ${command.description}`);
