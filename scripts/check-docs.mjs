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
  "packages/contracts/schemas/policy.v1.schema.json",
  "packages/contracts/schemas/decision.v1.schema.json",
  "packages/contracts/schemas/audit-event.v1.schema.json",
  "fixtures/policies/deny-by-default.json",
  "fixtures/policies/local-dev.json",
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

if (missing.length > 0 || forbiddenHits.length > 0) {
  for (const file of missing) {
    console.error(`missing required doc: ${file}`);
  }
  for (const hit of forbiddenHits) {
    console.error(`forbidden scaffold phrase: ${hit}`);
  }
  process.exit(1);
}
