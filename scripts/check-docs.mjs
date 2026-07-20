import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const requiredFiles = [
  "AGENTS.md",
  "CONTRIBUTING.md",
  "DEVELOPMENT.md",
  "LICENSE",
  "SECURITY.md",
  "diagrams/README.md",
  "docs/product/02-spec.md",
  "docs/architecture/04-policy-model.md",
  "docs/architecture/05-mcp-method-policy.md",
  "docs/architecture/06-data-flow-and-privacy.md",
  "docs/architecture/07-http-transport-plan.md",
  "docs/architecture/08-host-approval-ux-plan.md",
  "docs/architecture/09-external-mcp-compatibility-plan.md",
  "docs/architecture/10-audit-correlation-plan.md",
  "docs/adr/0001-initial-architecture-boundaries.md",
  "docs/adr/0003-open-source-license-and-private-data-boundary.md",
  "docs/adr/0004-implementation-stack-direction.md",
  "docs/adr/0006-lexical-path-policy-boundary.md",
  "docs/adr/0007-external-client-compatibility-matrix.md",
  "docs/adr/0008-runtime-mcp-sdk-boundary.md",
  "docs/adr/0009-codex-config-adapter.md",
  "docs/adr/0010-gemini-config-adapter.md",
  "docs/adr/0011-second-external-server-target.md",
  "docs/adr/0013-openfeature-ops-metrics-boundary.md",
  "docs/library/approval-hooks.md",
  "docs/library/decision-codes.md",
  "docs/cli/output-and-exit-codes.md",
  "docs/ops/observability.md",
  "docs/ops/external-runtime-dependencies.json",
  "docs/ops/npm-bootstrap.md",
  "docs/ops/npm-bootstrap-plan.json",
  "docs/ops/codex-config-compatibility-evidence.md",
  "docs/ops/gemini-config-compatibility-evidence.md",
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

const forbiddenPhrases = ["This document captures the durable design contract", "It is intentionally a scaffold"];

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

const cliContractFailures = [
  ...checkCliCommandDocs(),
  ...checkCliExitCodeDocs(),
  ...checkOpsOwnerDocs(),
  ...checkAuditExportDocs(),
  ...checkHttpTransportPlanDocs(),
  ...checkHostApprovalUxPlanDocs(),
  ...checkExternalMcpCompatibilityPlanDocs(),
  ...checkAuditCorrelationPlanDocs(),
  ...checkPathPolicyBoundaryDocs(),
  ...checkDecisionCodeDocs(),
  ...checkApprovalHookDocs(),
  ...checkProcessContainmentDocs(),
  ...checkQuickStartDocs()
];

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
  const expectedCommands = ["run", "config-snippet", "check-policy", "inspect-tools", "eval-call"];
  if (JSON.stringify(commands) !== JSON.stringify(expectedCommands)) {
    failures.push(
      `packages/cli/src/commands.ts: expected command list ${expectedCommands.join(", ")}, got ${commands.join(", ")}`
    );
  }
  for (const command of expectedCommands) {
    if (!commandContract.includes(`mcp-security-proxy ${command}`)) {
      failures.push(`docs/cli/command-contract.md: missing command section for ${command}`);
    }
  }
  for (const flag of [
    "--policy",
    "--profile",
    "--target",
    "--name",
    "--proxy-command",
    "--codex-command",
    "--gemini-command",
    "--input",
    "--approval-hook",
    "--audit-log",
    "--ops-feature-flags",
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

function checkCliExitCodeDocs() {
  const failures = [];
  const commandSource = readFileSync(join(root, "packages/cli/src/commands.ts"), "utf8");
  const runtimeSource = readFileSync(join(root, "packages/proxy-runtime/src/stdio-bridge.ts"), "utf8");
  const exitCodeContract = readFileSync(join(root, "docs/cli/output-and-exit-codes.md"), "utf8");
  const documentedCodes = extractDocumentedExitCodes(exitCodeContract);
  const expectedCodes = [0, 1, 2, 3, 4, 5];

  if (JSON.stringify(documentedCodes) !== JSON.stringify(expectedCodes)) {
    failures.push(
      `docs/cli/output-and-exit-codes.md: expected public exit codes ${expectedCodes.join(", ")}, got ${documentedCodes.join(", ")}`
    );
  }

  for (const [code, phrase] of [
    [0, "Command completed successfully"],
    [1, "Handled runtime failure"],
    [2, "CLI usage error"],
    [3, "Policy file parse or validation error"],
    [4, "Upstream MCP server startup, protocol, or non-zero exit failure"],
    [5, "Audit output failure"]
  ]) {
    const rowPattern = new RegExp(`\\| ${code} \\| [^\\n]*${escapeRegExp(phrase)}[^\\n]*\\|`);
    if (!rowPattern.test(exitCodeContract)) {
      failures.push(`docs/cli/output-and-exit-codes.md: missing or changed meaning for exit code ${code}`);
    }
  }

  if (!commandSource.includes("readonly exitCode: 2 | 3;")) {
    failures.push("packages/cli/src/commands.ts: CliError must stay limited to usage and policy validation exits");
  }
  if (!commandSource.includes("return { exitCode: 1 };")) {
    failures.push("packages/cli/src/commands.ts: handled runtime failure exit code 1 is not visible");
  }
  if (!runtimeSource.includes("return { exitCode: 4 };") || !runtimeSource.includes("fatalExitCode = 5;")) {
    failures.push("packages/proxy-runtime/src/stdio-bridge.ts: runtime exit code 4/5 mappings are not visible");
  }

  return failures;
}

function extractDocumentedExitCodes(markdown) {
  return [...markdown.matchAll(/^\| (\d+) \| .+ \|$/gm)].map((match) => Number(match[1]));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkOpsOwnerDocs() {
  const failures = [];
  const opsDir = join(root, "docs", "ops");
  for (const name of readdirSync(opsDir)
    .filter((item) => item.endsWith(".md"))
    .sort()) {
    const path = `docs/ops/${name}`;
    const text = readFileSync(join(root, path), "utf8");
    if (text.includes("Backup owner: UNASSIGNED")) {
      failures.push(`${path}: backup owner must name a responsible boundary`);
    }
  }
  return failures;
}

function checkAuditExportDocs() {
  const failures = [];
  const path = "docs/ops/observability.md";
  const text = readFileSync(join(root, path), "utf8");
  for (const phrase of [
    "msp.audit-event.v1",
    "Export allowlist:",
    "decision.evidence[].code",
    "redaction.counts",
    "raw secrets, environment values, prompt contents, full tool",
    "raw upstream stderr lines",
    "Live `run` must fail closed when audit writes fail",
    "collector transforms do not add raw request payloads or environment snapshots"
  ]) {
    if (!text.includes(phrase)) {
      failures.push(`${path}: missing audit export guidance phrase: ${phrase}`);
    }
  }
  return failures;
}

function checkHttpTransportPlanDocs() {
  const failures = [];
  const path = "docs/architecture/07-http-transport-plan.md";
  const text = readFileSync(join(root, path), "utf8");
  for (const phrase of [
    "HTTP transport is not implemented",
    "does not approve an HTTP server, HTTP client, hosted control plane",
    "preserve request and response correlation by exact JSON-RPC id value and type",
    "authentication, authorization, cookies, bearer tokens, and header privacy",
    "streaming response boundaries, reconnects, partial messages, and duplicate delivery",
    "header allowlist and redaction fixtures",
    "compatibility fixtures are registered in `fixtures/compatibility/manifest.json`",
    "release record names HTTP support as included or explicitly excluded"
  ]) {
    if (!text.includes(phrase)) {
      failures.push(`${path}: missing HTTP transport plan phrase: ${phrase}`);
    }
  }
  return failures;
}

function checkHostApprovalUxPlanDocs() {
  const failures = [];
  const path = "docs/architecture/08-host-approval-ux-plan.md";
  const text = readFileSync(join(root, path), "utf8");
  for (const phrase of [
    "Approval UX is host-owned",
    "does not approve any bundled approval UI",
    "approval-required calls are not forwarded until the host hook returns an explicit approval",
    "deny, timeout, close, dismiss, and navigation-away states must all resolve to deny",
    "Persistent or remembered approvals are not part of the current runtime contract",
    "raw rejection reason redaction",
    "compatibility fixtures are registered in `fixtures/compatibility/manifest.json`",
    "The CLI `run` command intentionally does not bundle approval UX"
  ]) {
    if (!text.includes(phrase)) {
      failures.push(`${path}: missing host approval UX plan phrase: ${phrase}`);
    }
  }
  return failures;
}

function checkExternalMcpCompatibilityPlanDocs() {
  const failures = [];
  const path = "docs/architecture/09-external-mcp-compatibility-plan.md";
  const text = readFileSync(join(root, path), "utf8");
  for (const phrase of [
    "does not claim compatibility with arbitrary MCP clients or servers",
    "does not select an MCP SDK",
    "Do not treat the repository fixture server as an external MCP server",
    "request and response ids are correlated by exact JSON-RPC value and type",
    "malformed, unmatched, oversized, or too-deep messages are dropped or denied without leaking raw",
    "compatibility fixtures are registered in `fixtures/compatibility/manifest.json`",
    "release record names external MCP compatibility fixtures as included or explicitly excluded",
    "external-filesystem-python-stdio",
    "mcp==1.28.1",
    "external-fetch-stdio",
    "mcp-server-fetch==2026.7.10"
  ]) {
    if (!text.includes(phrase)) {
      failures.push(`${path}: missing external MCP compatibility plan phrase: ${phrase}`);
    }
  }
  return failures;
}

function checkAuditCorrelationPlanDocs() {
  const failures = [];
  const path = "docs/architecture/10-audit-correlation-plan.md";
  const text = readFileSync(join(root, path), "utf8");
  for (const phrase of [
    "Audit correlation v2 is implemented",
    "Do not store raw JSON-RPC ids",
    "sessionId",
    "sequence",
    "transportEventId",
    "jsonRpcIdHash",
    "discoveryGeneration",
    "Pending request state stores correlation metadata alongside method and expiry",
    "Unmatched responses receive their own correlation metadata and must not guess a request link",
    "`jsonRpcIdHash` is HMAC-SHA-256",
    "Runtime audit correlation fixture"
  ]) {
    if (!text.includes(phrase)) {
      failures.push(`${path}: missing audit correlation plan phrase: ${phrase}`);
    }
  }
  return failures;
}

function checkPathPolicyBoundaryDocs() {
  const failures = [];
  const adrPath = "docs/adr/0006-lexical-path-policy-boundary.md";
  const productSpecPath = "docs/product/02-spec.md";
  const publicApiPath = "docs/library/public-api.md";
  const adr = readFileSync(join(root, adrPath), "utf8");
  const productSpec = readFileSync(join(root, productSpecPath), "utf8");
  const publicApi = readFileSync(join(root, publicApiPath), "utf8");
  const normalizedAdr = adr.replace(/\s+/g, " ");
  const normalizedProductSpec = productSpec.replace(/\s+/g, " ");
  const normalizedPublicApi = publicApi.replace(/\s+/g, " ");

  for (const phrase of [
    "The implemented path policy mode is `lexical`",
    "does not call filesystem APIs",
    "Windows junction",
    "time-of-check/time-of-use",
    "fail closed",
    "Host attestation may strengthen an argument-intent decision, but it is not containment",
    "No host attestation callback is implemented or exported by this ADR"
  ]) {
    if (!normalizedAdr.includes(phrase)) {
      failures.push(`${adrPath}: missing lexical path policy boundary phrase: ${phrase}`);
    }
  }

  if (!normalizedProductSpec.includes("lexical string normalization")) {
    failures.push(`${productSpecPath}: path rules must be described as lexical string normalization`);
  }

  if (!normalizedPublicApi.includes("No filesystem resolver or containment API is exported")) {
    failures.push(`${publicApiPath}: public API docs must state the filesystem containment boundary`);
  }

  return failures;
}

function checkDecisionCodeDocs() {
  const failures = [];
  const decisionSourcePath = "packages/contracts/src/decision.ts";
  const decisionCodesPath = "docs/library/decision-codes.md";
  const publicApiPath = "docs/library/public-api.md";
  const decisionSource = readFileSync(join(root, decisionSourcePath), "utf8");
  const decisionCodesDoc = readFileSync(join(root, decisionCodesPath), "utf8");
  const publicApiDoc = readFileSync(join(root, publicApiPath), "utf8");
  const exportedCodes = extractDecisionReasonCodes(decisionSource);
  const documentedCodes = extractDocumentedDecisionCodes(decisionCodesDoc);

  if (JSON.stringify(documentedCodes) !== JSON.stringify(exportedCodes)) {
    failures.push(
      `${decisionCodesPath}: documented decision codes must match DECISION_REASON_CODES (${exportedCodes.join(", ")})`
    );
  }

  for (const phrase of [
    "Consumers should route on `decision.evidence[].code`",
    "treat `reason` as human-readable operator text",
    "decision.v1.schema.json"
  ]) {
    if (!decisionCodesDoc.includes(phrase)) {
      failures.push(`${decisionCodesPath}: missing decision code consumer guidance phrase: ${phrase}`);
    }
  }

  if (!publicApiDoc.includes("docs/library/decision-codes.md")) {
    failures.push(`${publicApiPath}: public API docs must link the decision code catalog`);
  }

  return failures;
}

function extractDecisionReasonCodes(source) {
  const match = source.match(/export const DECISION_REASON_CODES = \[([\s\S]*?)\] as const;/);
  if (!match) {
    return [];
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

function extractDocumentedDecisionCodes(markdown) {
  return [...markdown.matchAll(/^\| `([^`]+)` \| .+ \|$/gm)].map((item) => item[1]);
}

function checkApprovalHookDocs() {
  const failures = [];
  const approvalDocsPath = "docs/library/approval-hooks.md";
  const publicApiPath = "docs/library/public-api.md";
  const runtimeReadmePath = "packages/proxy-runtime/README.md";
  const sessionSource = readFileSync(join(root, "packages/proxy-runtime/src/session.ts"), "utf8");
  const stdioBridgeSource = readFileSync(join(root, "packages/proxy-runtime/src/stdio-bridge.ts"), "utf8");
  const conformanceSource = readFileSync(join(root, "packages/proxy-runtime/src/approval-conformance.ts"), "utf8");
  const approvalDocs = readFileSync(join(root, approvalDocsPath), "utf8");
  const publicApiDoc = readFileSync(join(root, publicApiPath), "utf8");
  const runtimeReadme = readFileSync(join(root, runtimeReadmePath), "utf8");

  for (const sourcePhrase of [
    "export interface ApprovalRequest",
    "readonly approvalId: string;",
    "readonly profileId: string;",
    "readonly call: NormalizedToolCall;",
    "readonly decision: PolicyDecision;",
    "readonly signal: AbortSignal;",
    "export interface ApprovalResult",
    "readonly approved: boolean;",
    "export type ApprovalHook"
  ]) {
    if (!sessionSource.includes(sourcePhrase)) {
      failures.push(`packages/proxy-runtime/src/session.ts: missing approval hook source phrase: ${sourcePhrase}`);
    }
  }

  for (const sourcePhrase of [
    'schemaVersion: "msp.approval-hook-conformance.v1"',
    '"approve" | "reject" | "error" | "abort" | "concurrent"',
    "approval_hook.abort_not_settled",
    "approval_hook.concurrent_isolated"
  ]) {
    if (!conformanceSource.includes(sourcePhrase)) {
      failures.push(
        `packages/proxy-runtime/src/approval-conformance.ts: missing conformance source phrase: ${sourcePhrase}`
      );
    }
  }

  for (const sourcePhrase of [
    "readonly approveToolCall?: ApprovalHook;",
    "readonly approvalHookAvailable?: boolean;",
    "readonly approvalTimeoutMs?: number;"
  ]) {
    if (!stdioBridgeSource.includes(sourcePhrase)) {
      failures.push(
        `packages/proxy-runtime/src/stdio-bridge.ts: missing approval bridge source phrase: ${sourcePhrase}`
      );
    }
  }

  for (const phrase of [
    "Approval hooks receive normalized call facts and decision evidence only",
    "must not include the raw JSON-RPC envelope",
    "Host-provided rejection reasons are host-owned input",
    "They are not forwarded or stored verbatim",
    "No bundled approval UI",
    "No persistent or remembered approval store",
    "policy.approval_denied",
    "policy.approval_hook_failed",
    "policy.approval_hook_missing",
    "runApprovalHookConformance",
    "opaque per-call correlation value",
    "hosts must close pending UI, listeners, and background work when it aborts",
    "never includes hook rejection reasons or thrown error text",
    "approval_hook.not_settled"
  ]) {
    if (!approvalDocs.includes(phrase)) {
      failures.push(`${approvalDocsPath}: missing approval hook contract phrase: ${phrase}`);
    }
  }

  if (!publicApiDoc.includes("docs/library/approval-hooks.md")) {
    failures.push(`${publicApiPath}: public API docs must link the approval hook contract`);
  }
  for (const phrase of ["runApprovalHookConformance", "opaque `approvalId`", "AbortSignal"]) {
    if (!runtimeReadme.includes(phrase)) {
      failures.push(`${runtimeReadmePath}: missing approval conformance consumer phrase: ${phrase}`);
    }
  }

  return failures;
}

function checkProcessContainmentDocs() {
  const failures = [];
  const sourcePath = "packages/cli/src/windows-job-guardian.ts";
  const architecturePath = "docs/architecture/02-runtime-flow.md";
  const commandPath = "docs/cli/command-contract.md";
  const configPath = "docs/ops/config-and-env.md";
  const compatibilityPath = "docs/library/compatibility.md";
  const migrationPath = "docs/library/migration-guide.md";
  const cliReadmePath = "packages/cli/README.md";
  const source = readFileSync(join(root, sourcePath), "utf8");
  const architecture = readFileSync(join(root, architecturePath), "utf8");
  const command = readFileSync(join(root, commandPath), "utf8");
  const config = readFileSync(join(root, configPath), "utf8");
  const compatibility = readFileSync(join(root, compatibilityPath), "utf8");
  const migration = readFileSync(join(root, migrationPath), "utf8");
  const cliReadme = readFileSync(join(root, cliReadmePath), "utf8");
  const normalizedArchitecture = architecture.replace(/\s+/gu, " ");
  const normalizedCommand = command.replace(/\s+/gu, " ");
  const normalizedConfig = config.replace(/\s+/gu, " ");

  for (const phrase of [
    "CreateJobObject",
    "SetInformationJobObject",
    "AssignProcessToJobObject",
    "WaitForSingleObject",
    "0x00002000",
    '"SystemRoot", "WINDIR", "TEMP", "TMP"'
  ]) {
    if (!source.includes(phrase)) {
      failures.push(`${sourcePath}: missing Windows containment source phrase: ${phrase}`);
    }
  }
  for (const phrase of [
    "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE",
    "wait for the guardian readiness handshake",
    "Abrupt proxy termination on POSIX can still leave"
  ]) {
    if (!normalizedArchitecture.includes(phrase)) {
      failures.push(`${architecturePath}: missing Windows containment contract phrase: ${phrase}`);
    }
  }
  for (const phrase of [
    "resolves the operating system's absolute Windows PowerShell path",
    "receives only the proxy PID",
    "fails with exit code 4"
  ]) {
    if (!normalizedCommand.includes(phrase)) {
      failures.push(`${commandPath}: missing Windows containment command phrase: ${phrase}`);
    }
  }
  for (const phrase of [
    "does not receive policy data, upstream argv",
    "POSIX operators must still use an external supervisor"
  ]) {
    if (!normalizedConfig.includes(phrase)) {
      failures.push(`${configPath}: missing Windows containment operations phrase: ${phrase}`);
    }
  }
  for (const [path, text, phrase] of [
    [compatibilityPath, compatibility, "supported Windows runners exercise abrupt proxy termination"],
    [migrationPath, migration, "fails closed with exit code 4 before upstream startup"],
    [cliReadmePath, cliReadme, "abrupt proxy termination closes the Job"]
  ]) {
    if (!text.replace(/\s+/gu, " ").includes(phrase)) {
      failures.push(`${path}: missing Windows containment consumer phrase: ${phrase}`);
    }
  }
  return failures;
}

function checkQuickStartDocs() {
  const failures = [];
  const rootReadme = readFileSync(join(root, "README.md"), "utf8");
  const cliReadme = readFileSync(join(root, "packages/cli/README.md"), "utf8");
  const installCommand =
    "npm install --global @0disoft/mcp-security-proxy-cli@0.2.0-alpha.3 " +
    "@modelcontextprotocol/server-filesystem@2026.7.4";

  if (!rootReadme.includes(installCommand) || !rootReadme.includes("packages/cli/README.md#quick-start")) {
    failures.push("README.md: npm Quick Start must install exact versions and link the CLI onboarding contract");
  }
  for (const phrase of [
    installCommand,
    '"defaultAction": "deny"',
    '"tools": ["read_text_file"]',
    '"includeRawArguments": false',
    "mcp-security-proxy check-policy",
    "mcp-security-proxy config-snippet --target codex-cli-json",
    "codex mcp add secured-filesystem",
    "npm root --global",
    "Join-Path $globalRoot",
    "operating-system sandbox"
  ]) {
    if (!cliReadme.includes(phrase)) {
      failures.push(`packages/cli/README.md: npm Quick Start is missing ${phrase}`);
    }
  }
  return failures;
}
