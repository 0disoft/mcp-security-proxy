import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = [
  "AGENTS.md",
  "LICENSE",
  "SECURITY.md",
  "docs/product/02-spec.md",
  "docs/architecture/04-policy-model.md",
  "docs/architecture/05-mcp-method-policy.md",
  "docs/architecture/06-data-flow-and-privacy.md",
  "docs/adr/0001-initial-architecture-boundaries.md",
  "docs/adr/0003-open-source-license-and-private-data-boundary.md",
  "docs/adr/0004-implementation-stack-direction.md",
  "docs/ops/release-records/README.md",
  "docs/ops/release-records/public-release.template.json",
  "packages/contracts/schemas/policy.v1.schema.json",
  "packages/contracts/schemas/decision.v1.schema.json",
  "packages/contracts/schemas/audit-event.v1.schema.json",
  "fixtures/policies/deny-by-default.json",
  "fixtures/policies/local-dev.json",
  "fixtures/compatibility/manifest.json",
  "fixtures/mcp/call-file-read-denied.json",
  "fixtures/audit/decision-denied.redacted.jsonl"
];

const forbiddenPhrases = [
  "This document captures the durable design contract",
  "It is intentionally a scaffold"
];

const root = process.cwd();
const missing = requiredFiles.filter((file) => !existsSync(join(root, file)));

const forbiddenHits = [];
for (const file of requiredFiles) {
  const path = join(root, file);
  if (!existsSync(path)) {
    continue;
  }
  const text = readFileSync(path, "utf8");
  for (const phrase of forbiddenPhrases) {
    if (text.includes(phrase)) {
      forbiddenHits.push(`${file}: ${phrase}`);
    }
  }
}

const cliContractFailures = checkCliCommandDocs();

if (missing.length > 0 || forbiddenHits.length > 0 || cliContractFailures.length > 0) {
  for (const file of missing) {
    console.error(`missing required doc: ${file}`);
  }
  for (const hit of forbiddenHits) {
    console.error(`forbidden scaffold phrase: ${hit}`);
  }
  for (const failure of cliContractFailures) {
    console.error(failure);
  }
  process.exit(1);
}

function checkCliCommandDocs() {
  const failures = [];
  const commandSource = readFileSync(join(root, "packages/cli/src/commands.ts"), "utf8");
  const commandContract = readFileSync(join(root, "docs/cli/command-contract.md"), "utf8");
  const cliReadme = readFileSync(join(root, "docs/cli/README.md"), "utf8");
  const commands = extractCommandNames(commandSource);
  const expectedCommands = ["run", "check-policy", "inspect-tools", "eval-call"];
  if (JSON.stringify(commands) !== JSON.stringify(expectedCommands)) {
    failures.push(`packages/cli/src/commands.ts: expected command list ${expectedCommands.join(", ")}, got ${commands.join(", ")}`);
  }
  for (const command of expectedCommands) {
    if (!commandContract.includes(`mcp-security-proxy ${command}`)) {
      failures.push(`docs/cli/command-contract.md: missing command section for ${command}`);
    }
  }
  for (const flag of [
    "--policy",
    "--profile",
    "--input",
    "--approval-hook",
    "--audit-log",
    "--shutdown-grace-ms",
    "--max-frame-bytes",
    "--max-json-depth"
  ]) {
    if (!commandContract.includes(flag)) {
      failures.push(`docs/cli/command-contract.md: missing flag documentation for ${flag}`);
    }
  }
  if (commandContract.includes("--dry-run") || cliReadme.includes("--dry-run")) {
    failures.push("docs/cli: --dry-run flag is not implemented and must not be documented");
  }
  return failures;
}

function extractCommandNames(source) {
  const match = source.match(/export type CommandName = ([^;]+);/);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}
