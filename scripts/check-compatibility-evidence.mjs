import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const manifestPath = "fixtures/compatibility/manifest.json";
const localCompatibilityTarget = "local-stdio-mvp";
const externalCompatibilityTarget = "external-filesystem-stdio";
const externalPythonCompatibilityTarget = "external-filesystem-python-stdio";
const externalCompatibilityTargets = new Map([
  [
    externalCompatibilityTarget,
    {
      client: { package: "@modelcontextprotocol/sdk", version: "1.29.0" },
      server: { package: "@modelcontextprotocol/server-filesystem", version: "2026.7.4" },
      manifest: "fixtures/compatibility/external-filesystem-stdio.manifest.json",
      summary: "fixtures/compatibility/external-filesystem-stdio.summary.json",
      harness: "scripts/check-external-mcp-fixture.mjs"
    }
  ],
  [
    externalPythonCompatibilityTarget,
    {
      client: { package: "mcp", version: "1.28.1" },
      server: { package: "@modelcontextprotocol/server-filesystem", version: "2026.7.4" },
      manifest: "fixtures/compatibility/external-filesystem-python-stdio.manifest.json",
      summary: "fixtures/compatibility/external-filesystem-python-stdio.summary.json",
      harness: "scripts/check-external-python-mcp-fixture.mjs"
    }
  ]
]);
const requiredKinds = new Set([
  "mcp.discovery",
  "mcp.call.allowed",
  "mcp.call.denied",
  "mcp.call.approval-required",
  "audit.redaction",
  "cli.json.check-policy",
  "cli.json.inspect-tools",
  "cli.json.eval-call",
  "library.policy-parse",
  "library.decision-result",
  "library.audit-jsonl",
  "library.tool-call-normalization",
  "runtime.live-smoke",
  "runtime.ops-log",
  "runtime.session-result"
]);
const cliCommandByKind = new Map([
  ["cli.json.check-policy", "check-policy"],
  ["cli.json.inspect-tools", "inspect-tools"],
  ["cli.json.eval-call", "eval-call"]
]);
const runtimeCommandByKind = new Map([["runtime.live-smoke", ["node", "scripts/smoke-live-run.mjs"]]]);
const trackedFiles = new Set(
  execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"))
);
const requiredEvidenceIds = new Set([
  "mcp-discovery-basic",
  "mcp-call-file-read-allowed",
  "mcp-call-file-read-denied",
  "mcp-call-file-read-traversal",
  "mcp-call-network-allowed",
  "mcp-call-network-denied",
  "mcp-call-network-ambiguous",
  "mcp-call-shell-denied",
  "mcp-call-secret-denied",
  "mcp-call-secret-api-key-allowed",
  "mcp-call-workflow-approval",
  "audit-decision-denied-redacted",
  "cli-check-policy-local-dev",
  "cli-inspect-tools-local",
  "cli-eval-call-allowed-local",
  "cli-eval-call-denied-local",
  "cli-eval-call-file-read-traversal-local",
  "cli-eval-call-network-allowed-local",
  "cli-eval-call-network-denied-local",
  "cli-eval-call-network-ambiguous-local",
  "cli-eval-call-shell-denied-local",
  "cli-eval-call-secret-denied-local",
  "cli-eval-call-secret-api-key-allowed-local",
  "cli-eval-call-workflow-no-hook-local",
  "cli-eval-call-workflow-approval-hook-local",
  "library-policy-parse-local-dev",
  "library-decision-file-read-allowed",
  "library-decision-file-read-denied",
  "library-decision-file-read-traversal",
  "library-decision-network-allowed",
  "library-decision-network-denied",
  "library-decision-network-ambiguous",
  "library-decision-shell-denied",
  "library-decision-secret-denied",
  "library-decision-secret-api-key-allowed",
  "library-decision-workflow-no-hook",
  "library-decision-workflow-approval-hook",
  "library-audit-jsonl-method-denied",
  "library-tool-call-normalization",
  "runtime-live-stdio-smoke",
  "runtime-ops-log-local",
  "runtime-approval-rejected-redacted",
  "runtime-approval-hook-error",
  "runtime-approval-timeout",
  "runtime-audit-correlation",
  "runtime-client-envelope-sanitization",
  "runtime-client-ping-error-response",
  "runtime-client-ping-payload-response",
  "runtime-client-unsupported-method",
  "runtime-discovery-replacement",
  "runtime-duplicate-client-request-id",
  "runtime-duplicate-discovery",
  "runtime-duplicate-server-request-id",
  "runtime-malformed-discovery",
  "runtime-pending-discovery-id-type",
  "runtime-framing-boundary-denial",
  "runtime-invalid-jsonrpc-envelope-shape",
  "runtime-invalid-upstream-response-shape",
  "runtime-invalid-upstream-error-object",
  "runtime-unmatched-response-denial",
  "runtime-server-envelope-sanitization",
  "runtime-upstream-response-envelope-sanitization",
  "runtime-server-origin-unsupported-method",
  "runtime-server-origin-ping-invalid-response",
  "runtime-server-origin-ping-missing-id-denial",
  "runtime-server-origin-ping-params-denial",
  "runtime-upstream-error-data-redaction",
  "runtime-upstream-error-message-redaction",
  "runtime-upstream-error-extra-field-redaction"
]);

const failures = [];
const manifest = readJson(manifestPath);

if (manifest.schemaVersion !== "msp.compatibility-evidence.v1") {
  failures.push(`${manifestPath}: schemaVersion must be msp.compatibility-evidence.v1`);
}

if (manifest.target !== localCompatibilityTarget) {
  failures.push(`${manifestPath}: target must be ${localCompatibilityTarget}`);
}
checkManifestScope(manifestPath, manifest);
const compatibilityTargets = checkCompatibilityTargets(manifestPath, manifest);
for (const [targetId, spec] of externalCompatibilityTargets) {
  const externalTarget = compatibilityTargets.get(targetId);
  if (externalTarget) {
    checkExternalCompatibilityManifest(externalTarget.manifest, externalTarget, spec);
  }
}

if (!Array.isArray(manifest.evidence)) {
  failures.push(`${manifestPath}: evidence must be an array`);
}

const evidence = Array.isArray(manifest.evidence) ? manifest.evidence : [];
const seenIds = new Set();
const seenKinds = new Set();

for (const item of evidence) {
  if (!item || typeof item !== "object") {
    failures.push(`${manifestPath}: evidence entries must be objects`);
    continue;
  }
  await checkEvidenceEntry(item);
}

for (const kind of requiredKinds) {
  if (!seenKinds.has(kind)) {
    failures.push(`${manifestPath}: missing required compatibility evidence kind ${kind}`);
  }
}
for (const id of requiredEvidenceIds) {
  if (!seenIds.has(id)) {
    failures.push(`${manifestPath}: missing required compatibility evidence id ${id}`);
  }
}

await checkCompatibilityEvidenceValidator();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

async function checkEvidenceEntry(item) {
  const id = typeof item.id === "string" ? item.id : "";
  const kind = typeof item.kind === "string" ? item.kind : "";
  const path = typeof item.path === "string" ? item.path : "";
  checkEvidenceReference(id || manifestPath, "path", item.path);
  checkEvidenceReference(id || manifestPath, "policy", item.policy);
  checkEvidenceReference(id || manifestPath, "call", item.call);
  checkEvidenceReference(id || manifestPath, "envelope", item.envelope);

  if (!id) {
    failures.push(`${manifestPath}: evidence entry is missing id`);
  } else if (seenIds.has(id)) {
    failures.push(`${manifestPath}: duplicate evidence id ${id}`);
  } else {
    seenIds.add(id);
  }

  if (!requiredKinds.has(kind)) {
    failures.push(`${id || manifestPath}: unsupported evidence kind ${kind || "<missing>"}`);
  } else {
    seenKinds.add(kind);
  }

  if (kind === "runtime.live-smoke") {
    checkRuntimeFixture(id, kind, item.command);
    return;
  }

  if (!path || !existsSync(join(root, path))) {
    failures.push(`${id || manifestPath}: fixture path does not exist: ${path || "<missing>"}`);
    return;
  }

  if (kind.startsWith("mcp.") || kind.startsWith("cli.") || (kind.startsWith("library.") && kind !== "library.audit-jsonl")) {
    readJson(path);
  }
  if (kind === "audit.redaction") {
    checkAuditRedactionFixture(id, path);
  }
  if (kind.startsWith("cli.")) {
    checkCliFixture(id, kind, path, item.command);
  }
  if (kind === "library.policy-parse") {
    await checkLibraryPolicyParseFixture(id, path, item);
  }
  if (kind === "library.decision-result") {
    await checkLibraryDecisionFixture(id, path, item);
  }
  if (kind === "library.audit-jsonl") {
    await checkLibraryAuditJsonlFixture(id, path, item);
  }
  if (kind === "library.tool-call-normalization") {
    await checkLibraryToolCallNormalizationFixture(id, path, item);
  }
  if (kind === "runtime.session-result") {
    await checkRuntimeSessionFixture(id, path, item);
  }
  if (kind === "runtime.ops-log") {
    checkRuntimeOpsLogFixture(id, path);
  }
  if (kind === "mcp.discovery") {
    checkDiscoveryFixture(id, path);
  }
  if (kind === "mcp.call.allowed" || kind === "mcp.call.denied" || kind === "mcp.call.approval-required") {
    checkToolCallFixture(id, path);
  }
}

function checkManifestScope(path, manifestObject) {
  if (manifestObject.transport !== "stdio") {
    failures.push(`${path}: transport must be stdio for local-stdio-mvp evidence`);
  }
  if (manifestObject.fixtureSource !== "synthetic-local") {
    failures.push(`${path}: fixtureSource must be synthetic-local for local-stdio-mvp evidence`);
  }
}

function checkCompatibilityTargets(path, manifestObject) {
  const targets = new Map();
  if (!Array.isArray(manifestObject.targets) || manifestObject.targets.length === 0) {
    failures.push(`${path}: targets must be a non-empty array`);
    return targets;
  }

  for (const [index, target] of manifestObject.targets.entries()) {
    const label = `${path}: targets[${index}]`;
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      failures.push(`${label}: target entry must be an object`);
      continue;
    }
    const id = typeof target.id === "string" ? target.id : "";
    if (!id) {
      failures.push(`${label}: id must be recorded`);
      continue;
    }
    if (targets.has(id)) {
      failures.push(`${label}: duplicate compatibility target ${id}`);
      continue;
    }
    targets.set(id, target);

    if (id === localCompatibilityTarget) {
      checkLocalCompatibilityTarget(label, target);
    } else if (externalCompatibilityTargets.has(id)) {
      checkExternalCompatibilityTarget(label, target, externalCompatibilityTargets.get(id));
    } else {
      failures.push(`${label}: unsupported compatibility target ${id}`);
    }
  }

  if (!targets.has(localCompatibilityTarget)) {
    failures.push(`${path}: targets must include ${localCompatibilityTarget}`);
  }
  for (const targetId of externalCompatibilityTargets.keys()) {
    if (!targets.has(targetId)) {
      failures.push(`${path}: targets must include ${targetId}`);
    }
  }

  return targets;
}

function checkLocalCompatibilityTarget(label, target) {
  if (target.transport !== "stdio") {
    failures.push(`${label}: local target transport must be stdio`);
  }
  if (target.fixtureSource !== "synthetic-local") {
    failures.push(`${label}: local target fixtureSource must be synthetic-local`);
  }
  if (target.evidence !== "inline") {
    failures.push(`${label}: local target evidence must be inline`);
  }
}

function checkExternalCompatibilityTarget(label, target, spec) {
  if (target.transport !== "stdio") {
    failures.push(`${label}: external target transport must be stdio`);
  }
  if (target.fixtureSource !== "external-mcp") {
    failures.push(`${label}: external target fixtureSource must be external-mcp`);
  }
  if (target.client?.package !== spec.client.package || target.client?.version !== spec.client.version) {
    failures.push(`${label}: external target client package must be ${spec.client.package}@${spec.client.version}`);
  }
  if (target.server?.package !== spec.server.package || target.server?.version !== spec.server.version) {
    failures.push(`${label}: external target server package must be ${spec.server.package}@${spec.server.version}`);
  }
  checkEvidenceReference(label, "manifest", target.manifest);
  checkEvidenceReference(label, "summary", target.summary);
  checkEvidenceReference(label, "harness", target.harness);
  if (target.manifest !== spec.manifest) {
    failures.push(`${label}: external target manifest must be ${spec.manifest}`);
  }
  if (target.summary !== spec.summary) {
    failures.push(`${label}: external target summary must be ${spec.summary}`);
  }
  if (target.harness !== spec.harness) {
    failures.push(`${label}: external target harness must be ${spec.harness}`);
  }
  if (!Array.isArray(target.validationCommand) || stableJson(target.validationCommand) !== stableJson(["node", spec.harness])) {
    failures.push(`${label}: external target validationCommand must be node ${spec.harness}`);
  }
}

function checkExternalCompatibilityManifest(path, registryTarget, spec) {
  if (typeof path !== "string") {
    failures.push(`${manifestPath}: external target manifest must be recorded`);
    return;
  }
  if (!existsSync(join(root, path))) {
    failures.push(`${path}: external compatibility manifest is missing`);
    return;
  }
  if (!trackedFiles.has(path)) {
    failures.push(`${path}: external compatibility manifest must be tracked`);
    return;
  }
  const externalManifest = readJson(path);
  if (externalManifest.schemaVersion !== "msp.external-compatibility-evidence.v1") {
    failures.push(`${path}: schemaVersion must be msp.external-compatibility-evidence.v1`);
  }
  if (externalManifest.target !== registryTarget.id) {
    failures.push(`${path}: target must match ${manifestPath} registry target ${registryTarget.id}`);
  }
  if (externalManifest.transport !== "stdio") {
    failures.push(`${path}: transport must be stdio`);
  }
  if (externalManifest.transport !== registryTarget.transport) {
    failures.push(`${path}: transport must match ${manifestPath} registry target ${registryTarget.id}`);
  }
  if (externalManifest.fixtureSource !== "external-mcp") {
    failures.push(`${path}: fixtureSource must be external-mcp`);
  }
  if (externalManifest.fixtureSource !== registryTarget.fixtureSource) {
    failures.push(`${path}: fixtureSource must match ${manifestPath} registry target ${registryTarget.id}`);
  }
  if (externalManifest.client?.package !== spec.client.package || externalManifest.client?.version !== spec.client.version) {
    failures.push(`${path}: client package must be ${spec.client.package}@${spec.client.version}`);
  }
  if (externalManifest.client?.package !== registryTarget.client?.package || externalManifest.client?.version !== registryTarget.client?.version) {
    failures.push(`${path}: client must match ${manifestPath} registry target ${registryTarget.id}`);
  }
  if (
    externalManifest.server?.package !== spec.server.package ||
    externalManifest.server?.version !== spec.server.version
  ) {
    failures.push(`${path}: server package must be ${spec.server.package}@${spec.server.version}`);
  }
  if (externalManifest.server?.package !== registryTarget.server?.package || externalManifest.server?.version !== registryTarget.server?.version) {
    failures.push(`${path}: server must match ${manifestPath} registry target ${registryTarget.id}`);
  }
  checkEvidenceReference(path, "harness", externalManifest.harness);
  checkEvidenceReference(path, "summary", externalManifest.summary);
  if (externalManifest.harness !== registryTarget.harness) {
    failures.push(`${path}: harness must match ${manifestPath} registry target ${registryTarget.id}`);
  }
  if (externalManifest.summary !== registryTarget.summary) {
    failures.push(`${path}: summary must match ${manifestPath} registry target ${registryTarget.id}`);
  }
  if (typeof externalManifest.harness === "string" && !externalManifest.harness.startsWith("scripts/")) {
    failures.push(`${path}: harness must be under scripts/`);
  }
  if (typeof externalManifest.summary === "string" && !externalManifest.summary.startsWith("fixtures/compatibility/")) {
    failures.push(`${path}: summary must be under fixtures/compatibility/`);
  }
  if (!Array.isArray(externalManifest.scenarios) || externalManifest.scenarios.length === 0) {
    failures.push(`${path}: scenarios must be a non-empty array`);
  } else if (!externalManifest.scenarios.every((scenario) => typeof scenario === "string")) {
    failures.push(`${path}: scenarios must be strings`);
  }
  if (typeof externalManifest.summary === "string" && existsSync(join(root, externalManifest.summary))) {
    checkExternalFixtureSummary(path, externalManifest.summary, externalManifest);
  }
}

function checkExternalFixtureSummary(manifestLabel, summaryPath, externalManifest) {
  const summary = readJson(summaryPath);
  if (summary.schemaVersion !== "msp.external-fixture-summary.v1") {
    failures.push(`${summaryPath}: schemaVersion must be msp.external-fixture-summary.v1`);
  }
  for (const field of ["target", "transport", "fixtureSource"]) {
    if (summary[field] !== externalManifest[field]) {
      failures.push(`${summaryPath}: ${field} must match ${manifestLabel}`);
    }
  }
  if (summary.client?.package !== externalManifest.client?.package || summary.client?.version !== externalManifest.client?.version) {
    failures.push(`${summaryPath}: client must match ${manifestLabel}`);
  }
  if (summary.server?.package !== externalManifest.server?.package || summary.server?.version !== externalManifest.server?.version) {
    failures.push(`${summaryPath}: server must match ${manifestLabel}`);
  }
  if (summary.normalization?.fixtureRoot !== "<external-fixture-root>") {
    failures.push(`${summaryPath}: normalization.fixtureRoot must be <external-fixture-root>`);
  }
  if (summary.normalization?.elapsedMs !== 0) {
    failures.push(`${summaryPath}: normalization.elapsedMs must be 0`);
  }
  if (summary.normalization?.timestamps !== "<timestamp>") {
    failures.push(`${summaryPath}: normalization.timestamps must be <timestamp>`);
  }
  const scenarios = summary.scenarios;
  if (!scenarios || typeof scenarios !== "object" || Array.isArray(scenarios)) {
    failures.push(`${summaryPath}: scenarios must be an object`);
    return;
  }
  if (scenarios.initialize?.connected !== true) {
    failures.push(`${summaryPath}: initialize.connected must be true`);
  }
  if (scenarios.initialized?.accepted !== true) {
    failures.push(`${summaryPath}: initialized.accepted must be true`);
  }
  if (scenarios.toolsListFiltering?.includesReadTextFile !== true) {
    failures.push(`${summaryPath}: toolsListFiltering must include read_text_file`);
  }
  if (scenarios.toolsListFiltering?.includesListAllowedDirectories !== false) {
    failures.push(`${summaryPath}: toolsListFiltering must hide list_allowed_directories`);
  }
  if (scenarios.allowedPublicRead?.ok !== true || scenarios.allowedPublicRead?.textDigest !== "external-public-hello") {
    failures.push(`${summaryPath}: allowedPublicRead must prove the synthetic public read`);
  }
  if (!scenarioHasEvidenceCode(scenarios.deniedPrivateRead, "policy.rule_deny")) {
    failures.push(`${summaryPath}: deniedPrivateRead must include policy.rule_deny evidence`);
  }
  if (!scenarioHasEvidenceCode(scenarios.hiddenToolDirectCall, "tool.not_visible")) {
    failures.push(`${summaryPath}: hiddenToolDirectCall must include tool.not_visible evidence`);
  }
  if (scenarios.shutdown?.clientClosed !== true) {
    failures.push(`${summaryPath}: shutdown.clientClosed must be true`);
  }
  const auditCodes = Array.isArray(scenarios.audit?.evidenceCodes) ? scenarios.audit.evidenceCodes : [];
  for (const code of ["discovery.filtered", "policy.rule_allow", "policy.rule_deny", "tool.not_visible"]) {
    if (!auditCodes.includes(code)) {
      failures.push(`${summaryPath}: audit.evidenceCodes must include ${code}`);
    }
  }
  if (scenarios.audit?.containsRawFixtureRoot !== false) {
    failures.push(`${summaryPath}: audit must not contain the raw external fixture root`);
  }
}

function scenarioHasEvidenceCode(scenario, code) {
  return scenario?.ok === false && Array.isArray(scenario.evidenceCodes) && scenario.evidenceCodes.includes(code);
}

function checkRuntimeFixture(id, kind, command) {
  if (!checkRuntimeCommandShape(id, kind, command)) {
    return;
  }
  execFileSync(process.execPath, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function checkRuntimeOpsLogFixture(id, path) {
  const tempDir = mkdtempSync(join(tmpdir(), "msp-ops-compat-"));
  const auditLog = join(tempDir, "audit.jsonl");
  const opsLog = join(tempDir, "ops.jsonl");
  try {
    const output = execFileSync(
      process.execPath,
      [
        "packages/cli/dist/main.js",
        "run",
        "--policy",
        "fixtures/policies/local-dev.json",
        "--profile",
        "local",
        "--audit-log",
        auditLog,
        "--ops-log",
        opsLog,
        "--",
        process.execPath,
        "scripts/fixture-mcp-server.mjs"
      ],
      {
        cwd: root,
        encoding: "utf8",
        input: `${JSON.stringify({
          jsonrpc: "2.0",
          id: "ops-compat-denied",
          method: "tools/call",
          params: {
            name: "read_file",
            arguments: {
              path: "workspace/private/secret.txt"
            }
          }
        })}\n`,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    const outputLines = output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => parseJsonText(line, `${id}: stdout`));
    if (
      outputLines.length !== 1 ||
      outputLines[0]?.id !== "ops-compat-denied" ||
      outputLines[0]?.error?.data?.decision?.action !== "deny"
    ) {
      failures.push(`${id}: unexpected MCP stdout from ops-log compatibility run`);
    }
    if (output.includes("workspace/private/secret.txt")) {
      failures.push(`${id}: raw denied path leaked to MCP stdout`);
    }
    const actual = readFileSync(opsLog, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line, index) => normalizeOpsEvent(parseJsonText(line, `${id}: opsLog:${index + 1}`)));
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function normalizeOpsEvent(event) {
  if (!event || typeof event !== "object") {
    return event;
  }
  return {
    ...event,
    timestamp: "<timestamp>",
    ...(event.elapsedMs !== undefined ? { elapsedMs: 0 } : {})
  };
}

function checkDiscoveryFixture(id, path) {
  const fixture = readJson(path);
  if (!Array.isArray(fixture.tools)) {
    failures.push(`${id}: discovery fixture must contain a tools array`);
  }
}

function checkToolCallFixture(id, path) {
  const fixture = readJson(path);
  if (fixture.method !== "tools/call") {
    failures.push(`${id}: call fixture method must be tools/call`);
  }
  if (typeof fixture.toolName !== "string") {
    failures.push(`${id}: call fixture must include toolName`);
  }
  if (!Array.isArray(fixture.capabilities)) {
    failures.push(`${id}: call fixture must include capabilities`);
  }
}

function checkAuditRedactionFixture(id, path) {
  const text = readText(path);
  if (text.includes("REDACT_ME_VALUE_123")) {
    failures.push(`${id}: redaction fixture contains raw marker value`);
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    failures.push(`${id}: redaction fixture must contain at least one JSONL event`);
  }
  for (const [index, line] of lines.entries()) {
    const event = parseJsonText(line, `${path}:${index + 1}`);
    checkDecisionEvidenceCodes(`${path}:${index + 1}`, event);
    if (event?.redaction?.applied !== true) {
      failures.push(`${id}: redaction fixture event ${index + 1} must mark redaction.applied true`);
    }
  }
}

function checkCliFixture(id, kind, path, command) {
  if (!checkCliCommandShape(id, kind, command)) {
    return;
  }
  const output = execFileSync(process.execPath, command.slice(1), {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  const actual = parseJsonText(output, `${id}: stdout`);
  const expected = readJson(path);
  assertJsonEqual(id, actual, expected);
}

function checkCliCommandShape(id, kind, command) {
  if (!Array.isArray(command) || command.length < 3) {
    failures.push(`${id}: CLI evidence command must invoke the built CLI entrypoint`);
    return false;
  }
  if (command.some((arg) => typeof arg !== "string")) {
    failures.push(`${id}: CLI evidence command arguments must be strings`);
    return false;
  }
  if (command[0] !== "node" || command[1] !== "packages/cli/dist/main.js") {
    failures.push(`${id}: CLI evidence command must invoke node packages/cli/dist/main.js`);
    return false;
  }
  const expectedCommand = cliCommandByKind.get(kind);
  if (!expectedCommand) {
    failures.push(`${id}: CLI evidence kind ${kind || "<missing>"} is not mapped to a command`);
    return false;
  }
  if (command[2] !== expectedCommand) {
    failures.push(`${id}: CLI evidence kind ${kind} must run ${expectedCommand}`);
    return false;
  }
  checkCliCommandPathArguments(id, expectedCommand, command);
  return true;
}

function checkCliCommandPathArguments(id, expectedCommand, command) {
  const values = cliOptionValues(command);
  const requiredOptionsByCommand = new Map([
    ["check-policy", ["--policy"]],
    ["inspect-tools", ["--policy", "--input"]],
    ["eval-call", ["--policy", "--input"]]
  ]);
  for (const option of requiredOptionsByCommand.get(expectedCommand) ?? []) {
    if (!values.has(option)) {
      failures.push(`${id}: CLI evidence command must include ${option}`);
    }
  }

  for (const option of ["--policy", "--input"]) {
    const value = values.get(option);
    if (value === undefined) {
      continue;
    }
    checkEvidenceReference(id, `command ${option}`, value);
  }
}

function cliOptionValues(command) {
  const values = new Map();
  for (let index = 3; index < command.length; index += 1) {
    const arg = command[index];
    if (arg !== "--policy" && arg !== "--input") {
      continue;
    }
    const value = command[index + 1];
    if (typeof value === "string" && !value.startsWith("--")) {
      values.set(arg, value);
      index += 1;
    } else {
      values.set(arg, undefined);
    }
  }
  return values;
}

function checkRuntimeCommandShape(id, kind, command) {
  if (!Array.isArray(command) || command.length < 2) {
    failures.push(`${id}: runtime evidence command must invoke a checked runtime script`);
    return false;
  }
  if (command.some((arg) => typeof arg !== "string")) {
    failures.push(`${id}: runtime evidence command arguments must be strings`);
    return false;
  }
  const expectedCommand = runtimeCommandByKind.get(kind);
  if (!expectedCommand) {
    failures.push(`${id}: runtime evidence kind ${kind || "<missing>"} is not mapped to a command`);
    return false;
  }
  if (stableJson(command) !== stableJson(expectedCommand)) {
    failures.push(`${id}: runtime evidence kind ${kind} must run ${expectedCommand.join(" ")}`);
    return false;
  }
  const scriptPath = command[1];
  if (typeof scriptPath !== "string" || !trackedFiles.has(scriptPath)) {
    failures.push(`${id}: runtime evidence command script must be tracked`);
    return false;
  }
  return true;
}

function checkEvidenceReference(id, field, value) {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    failures.push(`${id}: evidence ${field} must be a string path when present`);
    return;
  }
  if (!isSafeRepoPath(value)) {
    failures.push(`${id}: evidence ${field} must be a safe repo-relative POSIX path`);
    return;
  }
  if (!trackedFiles.has(value)) {
    failures.push(`${id}: evidence ${field} must reference a tracked file`);
  }
}

function isSafeRepoPath(value) {
  if (value.length === 0 || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

async function checkLibraryDecisionFixture(id, path, item) {
  if (typeof item.policy !== "string" || typeof item.call !== "string" || typeof item.profile !== "string") {
    failures.push(`${id}: library evidence must include policy, call, and profile`);
    return;
  }
  const { evaluateToolCall } = await import("../packages/core/dist/index.js");
  const policy = readJson(item.policy);
  const call = readJson(item.call);
  if (item.approvalHookAvailable !== undefined && typeof item.approvalHookAvailable !== "boolean") {
    failures.push(`${id}: approvalHookAvailable must be a boolean when present`);
    return;
  }
  const actual = evaluateToolCall({
    policy,
    profileId: item.profile,
    call,
    ...(item.approvalHookAvailable !== undefined ? { approvalHookAvailable: item.approvalHookAvailable } : {})
  });
  const expected = readJson(path);
  assertJsonEqual(id, actual, expected);
}

async function checkLibraryPolicyParseFixture(id, path, item) {
  if (typeof item.policy !== "string") {
    failures.push(`${id}: policy parse evidence must include policy`);
    return;
  }
  const { parsePolicyDocumentJson } = await import("../packages/contracts/dist/index.js");
  const actual = parsePolicyDocumentJson(readText(item.policy));
  const expected = readJson(path);
  assertJsonEqual(id, actual, expected);
}

async function checkLibraryAuditJsonlFixture(id, path, item) {
  if (typeof item.policy !== "string" || typeof item.profile !== "string" || typeof item.method !== "string") {
    failures.push(`${id}: audit JSONL evidence must include policy, profile, and method`);
    return;
  }
  const { createAuditEvent, evaluateMcpMethod, formatAuditEventJsonLine, redactText } = await import("../packages/core/dist/index.js");
  const redacted = redactText("value REDACT_ME_VALUE_123");
  const actual = formatAuditEventJsonLine(
    createAuditEvent({
      kind: "method-denied",
      profileId: item.profile,
      method: item.method,
      decision: evaluateMcpMethod(item.method, readJson(item.policy)),
      redaction: redacted.summary
    })
  );
  const expected = readText(path);
  checkDecisionEvidenceCodes(`${id}: actual`, parseJsonText(actual, `${id}: actual JSONL`));
  checkDecisionEvidenceCodes(`${id}: expected`, parseJsonText(expected, `${id}: expected JSONL`));
  if (!expected.endsWith("\n")) {
    failures.push(`${id}: audit JSONL fixture must end with a newline`);
  }
  if (actual.includes("REDACT_ME_VALUE_123") || expected.includes("REDACT_ME_VALUE_123")) {
    failures.push(`${id}: audit JSONL evidence must not contain raw marker value`);
  }
  if (actual !== expected) {
    failures.push(`${id}: fixture drifted from current implementation`);
  }
}

async function checkLibraryToolCallNormalizationFixture(id, path, item) {
  if (typeof item.envelope !== "string" || typeof item.toolName !== "string" || !Array.isArray(item.capabilities)) {
    failures.push(`${id}: tool-call normalization evidence must include envelope, toolName, and capabilities`);
    return;
  }
  if (!item.capabilities.every((capability) => typeof capability === "string")) {
    failures.push(`${id}: tool-call normalization capabilities must be strings`);
    return;
  }
  const { normalizeToolCallEnvelope } = await import("../packages/mcp-adapter/dist/index.js");
  const actual = normalizeToolCallEnvelope(readJson(item.envelope), {
    name: item.toolName,
    capabilities: item.capabilities
  });
  const expected = readJson(path);
  assertJsonEqual(id, actual, expected);
  if (stableJson(actual).includes("synthetic-normalization-input-marker")) {
    failures.push(`${id}: normalized tool call must not contain synthetic input marker`);
  }
}

async function checkRuntimeSessionFixture(id, path, item) {
  if (typeof item.policy !== "string" || typeof item.profile !== "string" || typeof item.scenario !== "string") {
    failures.push(`${id}: runtime session evidence must include policy, profile, and scenario`);
    return;
  }
  const supportedScenarios = new Set([
    "approval-hook-error",
    "approval-rejected-redacted",
    "approval-timeout",
    "audit-correlation",
    "client-envelope-sanitization",
    "client-ping-error-response",
    "client-ping-payload-response",
    "client-unsupported-method",
    "discovery-replacement",
    "duplicate-client-request-id",
    "duplicate-discovery",
    "duplicate-server-request-id",
    "malformed-discovery",
    "pending-discovery-id-type",
    "framing-boundary-denial",
    "invalid-jsonrpc-envelope-shape",
    "invalid-upstream-response-shape",
    "invalid-upstream-error-object",
    "unmatched-response-denial",
    "server-envelope-sanitization",
    "upstream-response-envelope-sanitization",
    "server-origin-unsupported-method",
    "server-origin-ping-invalid-response",
    "server-origin-ping-missing-id-denial",
    "server-origin-ping-params-denial",
    "upstream-error-data-redaction",
    "upstream-error-message-redaction",
    "upstream-error-extra-field-redaction"
  ]);
  if (!supportedScenarios.has(item.scenario)) {
    failures.push(`${id}: unsupported runtime session scenario ${item.scenario}`);
    return;
  }

  const { createProxySession } = await import("../packages/proxy-runtime/dist/index.js");
  if (item.scenario === "audit-correlation") {
    const session = createProxySession({ policy: readJson(item.policy), profileId: item.profile });
    const request = session.handleClientLine(
      JSON.stringify({ jsonrpc: "2.0", id: "RAW_CORRELATION_ID_MARKER", method: "ping", trace: "removed" })
    );
    const response = session.handleServerLine(
      JSON.stringify({ jsonrpc: "2.0", id: "RAW_CORRELATION_ID_MARKER", result: {}, trace: "removed" })
    );
    const actual = {
      requestAuditEvent: request.auditEvents[0],
      responseAuditEvent: response.auditEvents[0],
      rawIdAbsent: !stableJson([...request.auditEvents, ...response.auditEvents]).includes("RAW_CORRELATION_ID_MARKER")
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }
  if (item.scenario.startsWith("approval-")) {
    const actual = await collectApprovalRuntimeSessionResult(createProxySession, item, id);
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "server-origin-ping-invalid-response") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const serverRequest = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-server-origin-ping",
        method: "ping"
      })
    );
    const invalidClientResponse = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-server-origin-ping",
        result: {
          marker: "RAW_INVALID_SERVER_ORIGIN_PING_RESPONSE_MARKER"
        }
      })
    );
    const actual = {
      serverRequestForwarded: serverRequest.forwardLine
        ? parseJsonText(serverRequest.forwardLine, `${id}: serverRequest.forwardLine`)
        : undefined,
      serverRequestAuditEvents: serverRequest.auditEvents,
      invalidClientResponseForwarded: invalidClientResponse.forwardLine !== undefined,
      invalidClientResponseAuditEvents: invalidClientResponse.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "server-origin-ping-missing-id-denial") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const missingId = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "ping"
      })
    );
    const actual = {
      missingIdForwarded: missingId.forwardLine !== undefined,
      missingIdResponse: missingId.responseLine ? parseJsonText(missingId.responseLine, `${id}: missingId.responseLine`) : null,
      missingIdAuditEvents: missingId.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "server-origin-ping-params-denial") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const objectParams = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-server-ping-object-params",
        method: "ping",
        params: {
          marker: "RAW_SERVER_PING_OBJECT_PARAMS_MARKER"
        }
      })
    );
    const arrayParams = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-server-ping-array-params",
        method: "ping",
        params: ["RAW_SERVER_PING_ARRAY_PARAMS_MARKER"]
      })
    );
    const actual = {
      objectParamsForwarded: objectParams.forwardLine !== undefined,
      objectParamsResponse: objectParams.responseLine
        ? parseJsonText(objectParams.responseLine, `${id}: objectParams.responseLine`)
        : undefined,
      objectParamsAuditEvents: objectParams.auditEvents,
      arrayParamsForwarded: arrayParams.forwardLine !== undefined,
      arrayParamsResponse: arrayParams.responseLine
        ? parseJsonText(arrayParams.responseLine, `${id}: arrayParams.responseLine`)
        : undefined,
      arrayParamsAuditEvents: arrayParams.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "framing-boundary-denial") {
    const tooLargeSession = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile,
      maxFrameBytes: 32
    });
    const newlineSession = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const tooDeepSession = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile,
      maxJsonDepth: 3
    });
    const tooLarge = tooLargeSession.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-too-large-frame",
        method: "ping"
      })
    );
    const embeddedNewline = newlineSession.handleClientLine(
      "{\"jsonrpc\":\"2.0\",\n\"id\":\"compat-embedded-newline\",\"method\":\"ping\"}"
    );
    const tooDeep = tooDeepSession.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-too-deep",
        result: {
          nested: {
            value: true
          }
        }
      })
    );
    const actual = {
      tooLargeForwarded: tooLarge.forwardLine !== undefined,
      tooLargeResponse: tooLarge.responseLine ? parseJsonText(tooLarge.responseLine, `${id}: tooLarge.responseLine`) : null,
      tooLargeAuditEvents: tooLarge.auditEvents,
      embeddedNewlineForwarded: embeddedNewline.forwardLine !== undefined,
      embeddedNewlineResponse: embeddedNewline.responseLine
        ? parseJsonText(embeddedNewline.responseLine, `${id}: embeddedNewline.responseLine`)
        : null,
      embeddedNewlineAuditEvents: embeddedNewline.auditEvents,
      tooDeepForwarded: tooDeep.forwardLine !== undefined,
      tooDeepResponse: tooDeep.responseLine ? parseJsonText(tooDeep.responseLine, `${id}: tooDeep.responseLine`) : null,
      tooDeepAuditEvents: tooDeep.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "invalid-jsonrpc-envelope-shape") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const invalidId = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: {
          marker: "RAW_INVALID_ID_MARKER"
        },
        method: "tools/list"
      })
    );
    const invalidMethod = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-invalid-method",
        method: {
          marker: "RAW_INVALID_METHOD_MARKER"
        }
      })
    );
    const requestWithResult = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-request-with-result",
        method: "tools/list",
        result: {
          marker: "RAW_REQUEST_RESULT_MARKER"
        }
      })
    );
    const initializedWithId = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-initialized-with-id",
        method: "notifications/initialized"
      })
    );
    const actual = {
      invalidIdForwarded: invalidId.forwardLine !== undefined,
      invalidIdResponse: invalidId.responseLine ? parseJsonText(invalidId.responseLine, `${id}: invalidId.responseLine`) : null,
      invalidIdAuditEvents: invalidId.auditEvents,
      invalidMethodForwarded: invalidMethod.forwardLine !== undefined,
      invalidMethodResponse: invalidMethod.responseLine
        ? parseJsonText(invalidMethod.responseLine, `${id}: invalidMethod.responseLine`)
        : null,
      invalidMethodAuditEvents: invalidMethod.auditEvents,
      requestWithResultForwarded: requestWithResult.forwardLine !== undefined,
      requestWithResultResponse: requestWithResult.responseLine
        ? parseJsonText(requestWithResult.responseLine, `${id}: requestWithResult.responseLine`)
        : null,
      requestWithResultAuditEvents: requestWithResult.auditEvents,
      initializedWithIdForwarded: initializedWithId.forwardLine !== undefined,
      initializedWithIdResponse: initializedWithId.responseLine
        ? parseJsonText(initializedWithId.responseLine, `${id}: initializedWithId.responseLine`)
        : null,
      initializedWithIdAuditEvents: initializedWithId.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "invalid-upstream-response-shape") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-invalid-shape-tools",
        method: "tools/list"
      })
    );
    const both = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-invalid-shape-tools",
        result: readJson("fixtures/mcp/tools-list-basic.json"),
        error: {
          code: -32000,
          message: "RAW_INVALID_RESPONSE_ERROR_MARKER"
        }
      })
    );
    const callAfterInvalid = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-call-after-invalid-response-shape",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );
    const neither = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-empty-upstream-response"
      })
    );
    const actual = {
      bothForwarded: both.forwardLine !== undefined,
      bothResponse: both.responseLine ? parseJsonText(both.responseLine, `${id}: both.responseLine`) : null,
      bothAuditEvents: both.auditEvents,
      callAfterInvalidForwarded: callAfterInvalid.forwardLine !== undefined,
      callAfterInvalidResponse: callAfterInvalid.responseLine
        ? parseJsonText(callAfterInvalid.responseLine, `${id}: callAfterInvalid.responseLine`)
        : undefined,
      callAfterInvalidAuditEvents: callAfterInvalid.auditEvents,
      neitherForwarded: neither.forwardLine !== undefined,
      neitherResponse: neither.responseLine ? parseJsonText(neither.responseLine, `${id}: neither.responseLine`) : null,
      neitherAuditEvents: neither.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "invalid-upstream-error-object") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const invalidFields = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-invalid-error-fields",
        error: {
          code: "not-a-number",
          message: "RAW_INVALID_ERROR_MESSAGE_MARKER"
        }
      })
    );
    const nonObject = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-invalid-error-member",
        error: "RAW_INVALID_ERROR_MEMBER_MARKER"
      })
    );
    const actual = {
      invalidFieldsForwarded: invalidFields.forwardLine !== undefined,
      invalidFieldsResponse: invalidFields.responseLine
        ? parseJsonText(invalidFields.responseLine, `${id}: invalidFields.responseLine`)
        : null,
      invalidFieldsAuditEvents: invalidFields.auditEvents,
      nonObjectForwarded: nonObject.forwardLine !== undefined,
      nonObjectResponse: nonObject.responseLine ? parseJsonText(nonObject.responseLine, `${id}: nonObject.responseLine`) : null,
      nonObjectAuditEvents: nonObject.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "unmatched-response-denial") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const upstream = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-unmatched-upstream-response",
        result: {
          marker: "RAW_UNMATCHED_UPSTREAM_RESPONSE_MARKER"
        }
      })
    );
    const client = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-unmatched-client-response",
        result: {
          marker: "RAW_UNMATCHED_CLIENT_RESPONSE_MARKER"
        }
      })
    );
    const actual = {
      upstreamForwarded: upstream.forwardLine !== undefined,
      upstreamResponse: upstream.responseLine ? parseJsonText(upstream.responseLine, `${id}: upstream.responseLine`) : null,
      upstreamAuditEvents: upstream.auditEvents,
      clientForwarded: client.forwardLine !== undefined,
      clientResponse: client.responseLine ? parseJsonText(client.responseLine, `${id}: client.responseLine`) : null,
      clientAuditEvents: client.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "server-envelope-sanitization") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const ping = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-server-ping-envelope-extra",
        method: "ping",
        trace: "RAW_SERVER_REQUEST_ENVELOPE_TRACE_MARKER"
      })
    );
    const actual = {
      pingForwarded: ping.forwardLine ? parseJsonText(ping.forwardLine, `${id}: ping.forwardLine`) : undefined,
      pingResponse: ping.responseLine ? parseJsonText(ping.responseLine, `${id}: ping.responseLine`) : null,
      pingAuditEvents: ping.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "upstream-response-envelope-sanitization") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-success-response-envelope-extra",
        method: "ping"
      })
    );
    const success = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-success-response-envelope-extra",
        result: {},
        trace: "RAW_UPSTREAM_SUCCESS_RESPONSE_TRACE_MARKER",
        debug: {
          marker: "RAW_UPSTREAM_SUCCESS_RESPONSE_DEBUG_MARKER"
        }
      })
    );
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-error-response-envelope-extra",
        method: "ping"
      })
    );
    const error = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-error-response-envelope-extra",
        error: {
          code: -32000,
          message: "upstream failure"
        },
        trace: {
          marker: "RAW_UPSTREAM_ERROR_RESPONSE_TRACE_MARKER"
        }
      })
    );
    const actual = {
      successForwarded: success.forwardLine ? parseJsonText(success.forwardLine, `${id}: success.forwardLine`) : undefined,
      successResponse: success.responseLine ? parseJsonText(success.responseLine, `${id}: success.responseLine`) : null,
      successAuditEvents: success.auditEvents,
      errorForwarded: error.forwardLine ? parseJsonText(error.forwardLine, `${id}: error.forwardLine`) : undefined,
      errorResponse: error.responseLine ? parseJsonText(error.responseLine, `${id}: error.responseLine`) : null,
      errorAuditEvents: error.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "client-ping-payload-response") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const serverPing = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-server-ping-payload-response",
        method: "ping"
      })
    );
    const clientPayloadResponse = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-server-ping-payload-response",
        result: {
          marker: "RAW_CLIENT_PING_RESPONSE_MARKER"
        }
      })
    );
    const actual = {
      serverPingForwarded: serverPing.forwardLine
        ? parseJsonText(serverPing.forwardLine, `${id}: serverPing.forwardLine`)
        : undefined,
      serverPingAuditEvents: serverPing.auditEvents,
      clientPayloadResponseForwarded: clientPayloadResponse.forwardLine !== undefined,
      clientPayloadResponseResponse: clientPayloadResponse.responseLine
        ? parseJsonText(clientPayloadResponse.responseLine, `${id}: clientPayloadResponse.responseLine`)
        : null,
      clientPayloadResponseAuditEvents: clientPayloadResponse.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "client-ping-error-response") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const serverPing = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-server-ping-error-response",
        method: "ping"
      })
    );
    const clientErrorResponse = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-server-ping-error-response",
        error: {
          code: -32000,
          message: "RAW_CLIENT_PING_ERROR_MARKER"
        }
      })
    );
    const actual = {
      serverPingForwarded: serverPing.forwardLine
        ? parseJsonText(serverPing.forwardLine, `${id}: serverPing.forwardLine`)
        : undefined,
      serverPingAuditEvents: serverPing.auditEvents,
      clientErrorResponseForwarded: clientErrorResponse.forwardLine !== undefined,
      clientErrorResponseResponse: clientErrorResponse.responseLine
        ? parseJsonText(clientErrorResponse.responseLine, `${id}: clientErrorResponse.responseLine`)
        : null,
      clientErrorResponseAuditEvents: clientErrorResponse.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "upstream-error-data-redaction") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const request = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-error-with-data",
        method: "ping"
      })
    );
    const upstreamError = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-error-with-data",
        error: {
          code: -32000,
          message: "upstream failure",
          data: {
            marker: "RAW_ERROR_DATA_MARKER",
            path: "workspace/private/secret.txt"
          }
        }
      })
    );
    const actual = {
      requestForwarded: request.forwardLine ? parseJsonText(request.forwardLine, `${id}: request.forwardLine`) : undefined,
      requestAuditEvents: request.auditEvents,
      upstreamErrorForwarded: upstreamError.forwardLine
        ? parseJsonText(upstreamError.forwardLine, `${id}: upstreamError.forwardLine`)
        : undefined,
      upstreamErrorResponse: upstreamError.responseLine
        ? parseJsonText(upstreamError.responseLine, `${id}: upstreamError.responseLine`)
        : null,
      upstreamErrorAuditEvents: upstreamError.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "client-envelope-sanitization") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-envelope-tools",
        method: "tools/list"
      })
    );
    const discovery = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-envelope-tools",
        result: readJson("fixtures/mcp/tools-list-basic.json")
      })
    );
    const call = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-call-with-envelope-extra",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        },
        trace: {
          marker: "RAW_TOOL_CALL_ENVELOPE_TRACE_MARKER"
        }
      })
    );
    const actual = {
      discoveryForwarded: discovery.forwardLine
        ? parseJsonText(discovery.forwardLine, `${id}: discovery.forwardLine`)
        : undefined,
      discoveryAuditEvents: discovery.auditEvents,
      callForwarded: call.forwardLine ? parseJsonText(call.forwardLine, `${id}: call.forwardLine`) : undefined,
      callResponse: call.responseLine ? parseJsonText(call.responseLine, `${id}: call.responseLine`) : null,
      callAuditEvents: call.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "upstream-error-message-redaction") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const request = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-error-with-sensitive-message",
        method: "ping"
      })
    );
    const upstreamError = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-error-with-sensitive-message",
        error: {
          code: -32000,
          message: "failed to read workspace/private/error-message.txt"
        }
      })
    );
    const actual = {
      requestForwarded: request.forwardLine ? parseJsonText(request.forwardLine, `${id}: request.forwardLine`) : undefined,
      requestAuditEvents: request.auditEvents,
      upstreamErrorForwarded: upstreamError.forwardLine
        ? parseJsonText(upstreamError.forwardLine, `${id}: upstreamError.forwardLine`)
        : undefined,
      upstreamErrorResponse: upstreamError.responseLine
        ? parseJsonText(upstreamError.responseLine, `${id}: upstreamError.responseLine`)
        : null,
      upstreamErrorAuditEvents: upstreamError.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "upstream-error-extra-field-redaction") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const request = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-error-with-extra-fields",
        method: "ping"
      })
    );
    const upstreamError = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-error-with-extra-fields",
        error: {
          code: -32000,
          message: "upstream failure",
          stack: "RAW_ERROR_STACK_MARKER at workspace/private/secret.txt",
          details: {
            marker: "RAW_ERROR_DETAILS_MARKER"
          }
        }
      })
    );
    const actual = {
      requestForwarded: request.forwardLine ? parseJsonText(request.forwardLine, `${id}: request.forwardLine`) : undefined,
      requestAuditEvents: request.auditEvents,
      upstreamErrorForwarded: upstreamError.forwardLine
        ? parseJsonText(upstreamError.forwardLine, `${id}: upstreamError.forwardLine`)
        : undefined,
      upstreamErrorResponse: upstreamError.responseLine
        ? parseJsonText(upstreamError.responseLine, `${id}: upstreamError.responseLine`)
        : null,
      upstreamErrorAuditEvents: upstreamError.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "client-unsupported-method") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/list",
        params: {}
      })
    );
    const actual = {
      forwarded: result.forwardLine !== undefined,
      response: result.responseLine ? parseJsonText(result.responseLine, `${id}: responseLine`) : undefined,
      auditEvents: result.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "duplicate-client-request-id") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const first = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-duplicate-client-id",
        method: "tools/list"
      })
    );
    const duplicate = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-duplicate-client-id",
        method: "ping"
      })
    );
    const originalResponse = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-duplicate-client-id",
        result: readJson("fixtures/mcp/tools-list-basic.json")
      })
    );
    const callAfterOriginalResponse = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-call-after-duplicate-client-id",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );
    const actual = {
      firstForwarded: first.forwardLine ? parseJsonText(first.forwardLine, `${id}: first.forwardLine`) : undefined,
      firstAuditEvents: first.auditEvents,
      duplicateForwarded: duplicate.forwardLine !== undefined,
      duplicateResponse: duplicate.responseLine ? parseJsonText(duplicate.responseLine, `${id}: duplicate.responseLine`) : undefined,
      duplicateAuditEvents: duplicate.auditEvents,
      originalResponseForwarded: originalResponse.forwardLine
        ? parseJsonText(originalResponse.forwardLine, `${id}: originalResponse.forwardLine`)
        : undefined,
      originalResponseAuditEvents: originalResponse.auditEvents,
      callAfterOriginalResponseForwarded: callAfterOriginalResponse.forwardLine
        ? parseJsonText(callAfterOriginalResponse.forwardLine, `${id}: callAfterOriginalResponse.forwardLine`)
        : undefined,
      callAfterOriginalResponseResponse: callAfterOriginalResponse.responseLine
        ? parseJsonText(callAfterOriginalResponse.responseLine, `${id}: callAfterOriginalResponse.responseLine`)
        : null,
      callAfterOriginalResponseAuditEvents: callAfterOriginalResponse.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "duplicate-server-request-id") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    const first = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-duplicate-server-id",
        method: "ping"
      })
    );
    const duplicate = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-duplicate-server-id",
        method: "ping"
      })
    );
    const originalResponse = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-duplicate-server-id",
        result: {}
      })
    );
    const actual = {
      firstForwarded: first.forwardLine ? parseJsonText(first.forwardLine, `${id}: first.forwardLine`) : undefined,
      firstAuditEvents: first.auditEvents,
      duplicateForwarded: duplicate.forwardLine !== undefined,
      duplicateResponse: duplicate.responseLine ? parseJsonText(duplicate.responseLine, `${id}: duplicate.responseLine`) : undefined,
      duplicateAuditEvents: duplicate.auditEvents,
      originalResponseForwarded: originalResponse.forwardLine
        ? parseJsonText(originalResponse.forwardLine, `${id}: originalResponse.forwardLine`)
        : undefined,
      originalResponseAuditEvents: originalResponse.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "duplicate-discovery") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-duplicate-tools",
        method: "tools/list"
      })
    );
    const duplicateDiscovery = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-duplicate-tools",
        result: {
          tools: [
            {
              name: "read_file",
              title: "Read File",
              description: "Read a file from a caller-provided path."
            },
            {
              name: "read_file",
              title: "RAW_DUPLICATE_COMPAT_DESCRIPTOR_TITLE_MARKER",
              description: "Read a file from a caller-provided path with RAW_DUPLICATE_COMPAT_DESCRIPTOR_DESC_MARKER.",
              inputSchema: {
                type: "object",
                properties: {
                  path: {
                    type: "string",
                    default: "RAW_DUPLICATE_COMPAT_DESCRIPTOR_SCHEMA_MARKER"
                  }
                }
              }
            }
          ]
        }
      })
    );
    const callAfterDuplicateDiscovery = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-call-after-duplicate-discovery",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );
    const actual = {
      duplicateDiscoveryForwarded: duplicateDiscovery.forwardLine
        ? parseJsonText(duplicateDiscovery.forwardLine, `${id}: duplicateDiscovery.forwardLine`)
        : undefined,
      duplicateDiscoveryAuditEvents: duplicateDiscovery.auditEvents,
      callAfterDuplicateDiscoveryForwarded: callAfterDuplicateDiscovery.forwardLine
        ? parseJsonText(callAfterDuplicateDiscovery.forwardLine, `${id}: callAfterDuplicateDiscovery.forwardLine`)
        : null,
      callAfterDuplicateDiscoveryResponse: callAfterDuplicateDiscovery.responseLine
        ? parseJsonText(callAfterDuplicateDiscovery.responseLine, `${id}: callAfterDuplicateDiscovery.responseLine`)
        : null,
      callAfterDuplicateDiscoveryAuditEvents: callAfterDuplicateDiscovery.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "discovery-replacement") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-replacement-tools-1",
        method: "tools/list"
      })
    );
    const initialDiscovery = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-replacement-tools-1",
        result: readJson("fixtures/mcp/tools-list-basic.json")
      })
    );
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-replacement-tools-2",
        method: "tools/list"
      })
    );
    const replacementDiscovery = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-replacement-tools-2",
        result: {
          tools: [
            {
              name: "unknown_tool",
              description: "Do something vaguely useful."
            }
          ]
        }
      })
    );
    const callAfterReplacement = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-call-after-replacement",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );
    const actual = {
      initialDiscoveryForwarded: initialDiscovery.forwardLine
        ? parseJsonText(initialDiscovery.forwardLine, `${id}: initialDiscovery.forwardLine`)
        : undefined,
      initialDiscoveryAuditEvents: initialDiscovery.auditEvents,
      replacementDiscoveryForwarded: replacementDiscovery.forwardLine
        ? parseJsonText(replacementDiscovery.forwardLine, `${id}: replacementDiscovery.forwardLine`)
        : undefined,
      replacementDiscoveryAuditEvents: replacementDiscovery.auditEvents,
      callAfterReplacementForwarded: callAfterReplacement.forwardLine !== undefined,
      callAfterReplacementResponse: callAfterReplacement.responseLine
        ? parseJsonText(callAfterReplacement.responseLine, `${id}: callAfterReplacement.responseLine`)
        : undefined,
      callAfterReplacementAuditEvents: callAfterReplacement.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "pending-discovery-id-type") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "tools/list"
      })
    );
    const numericIdResponse = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: readJson("fixtures/mcp/tools-list-basic.json")
      })
    );
    const deniedBeforeMatchingDiscovery = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-call-before-matching-discovery",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );
    const stringIdResponse = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        result: readJson("fixtures/mcp/tools-list-basic.json")
      })
    );
    const allowedAfterMatchingDiscovery = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-call-after-matching-discovery",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );
    const actual = {
      numericIdResponseForwarded: numericIdResponse.forwardLine !== undefined,
      numericIdResponseAuditEvents: numericIdResponse.auditEvents,
      deniedBeforeMatchingDiscoveryForwarded: deniedBeforeMatchingDiscovery.forwardLine !== undefined,
      deniedBeforeMatchingDiscoveryResponse: deniedBeforeMatchingDiscovery.responseLine
        ? parseJsonText(deniedBeforeMatchingDiscovery.responseLine, `${id}: deniedBeforeMatchingDiscovery.responseLine`)
        : undefined,
      deniedBeforeMatchingDiscoveryAuditEvents: deniedBeforeMatchingDiscovery.auditEvents,
      stringIdResponseForwarded: stringIdResponse.forwardLine
        ? parseJsonText(stringIdResponse.forwardLine, `${id}: stringIdResponse.forwardLine`)
        : undefined,
      stringIdResponseAuditEvents: stringIdResponse.auditEvents,
      allowedAfterMatchingDiscoveryForwarded: allowedAfterMatchingDiscovery.forwardLine
        ? parseJsonText(allowedAfterMatchingDiscovery.forwardLine, `${id}: allowedAfterMatchingDiscovery.forwardLine`)
        : undefined,
      allowedAfterMatchingDiscoveryResponse: allowedAfterMatchingDiscovery.responseLine
        ? parseJsonText(allowedAfterMatchingDiscovery.responseLine, `${id}: allowedAfterMatchingDiscovery.responseLine`)
        : null,
      allowedAfterMatchingDiscoveryAuditEvents: allowedAfterMatchingDiscovery.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "malformed-discovery") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-malformed-tools",
        method: "tools/list"
      })
    );
    const malformedDiscovery = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-malformed-tools",
        result: {
          tools: {
            leaked: "RAW_MALFORMED_COMPAT_DISCOVERY_TOOLS_MARKER"
          },
          debug: "RAW_MALFORMED_COMPAT_DISCOVERY_RESULT_MARKER"
        }
      })
    );
    const callAfterMalformedDiscovery = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-call-after-malformed-discovery",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );
    const actual = {
      malformedDiscoveryForwarded: malformedDiscovery.forwardLine
        ? parseJsonText(malformedDiscovery.forwardLine, `${id}: malformedDiscovery.forwardLine`)
        : undefined,
      malformedDiscoveryAuditEvents: malformedDiscovery.auditEvents,
      callAfterMalformedDiscoveryForwarded: callAfterMalformedDiscovery.forwardLine !== undefined,
      callAfterMalformedDiscoveryResponse: callAfterMalformedDiscovery.responseLine
        ? parseJsonText(callAfterMalformedDiscovery.responseLine, `${id}: callAfterMalformedDiscovery.responseLine`)
        : undefined,
      callAfterMalformedDiscoveryAuditEvents: callAfterMalformedDiscovery.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }

  if (item.scenario === "server-origin-unsupported-method") {
    const session = createProxySession({
      policy: readJson(item.policy),
      profileId: item.profile
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-pending-tools-list",
        method: "tools/list"
      })
    );
    const deniedServerRequest = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-pending-tools-list",
        method: "sampling/createMessage",
        params: {
          messages: []
        }
      })
    );
    const pendingClientResponse = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "compat-pending-tools-list",
        result: readJson("fixtures/mcp/tools-list-basic.json")
      })
    );
    const actual = {
      deniedServerRequestForwarded: deniedServerRequest.forwardLine !== undefined,
      deniedServerRequestResponse: deniedServerRequest.responseLine
        ? parseJsonText(deniedServerRequest.responseLine, `${id}: deniedServerRequest.responseLine`)
        : undefined,
      deniedServerRequestAuditEvents: deniedServerRequest.auditEvents,
      pendingClientResponseForwarded: pendingClientResponse.forwardLine
        ? parseJsonText(pendingClientResponse.forwardLine, `${id}: pendingClientResponse.forwardLine`)
        : undefined,
      pendingClientResponseAuditEvents: pendingClientResponse.auditEvents
    };
    const expected = readJson(path);
    assertJsonEqual(id, actual, expected);
    return;
  }
}

async function collectApprovalRuntimeSessionResult(createProxySession, item, id) {
  const approvalScenario = approvalRuntimeScenario(item.scenario);
  const session = createProxySession({
    policy: readJson(item.policy),
    profileId: item.profile,
    ...(approvalScenario.approvalTimeoutMs !== undefined ? { approvalTimeoutMs: approvalScenario.approvalTimeoutMs } : {})
  });
  session.handleClientLine(JSON.stringify({ jsonrpc: "2.0", id: approvalScenario.discoveryRequestId, method: "tools/list" }));
  session.handleServerLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: approvalScenario.discoveryRequestId,
      result: {
        tools: [
          {
            name: "run_command",
            description: "Run a shell command."
          }
        ]
      }
    })
  );

  const result = await session.handleClientLineWithApproval(
    JSON.stringify({
      jsonrpc: "2.0",
      id: approvalScenario.callRequestId,
      method: "tools/call",
      params: {
        name: "run_command",
        arguments: {}
      }
    }),
    approvalScenario.hook
  );
  return {
    forwarded: result.forwardLine !== undefined,
    response: result.responseLine ? parseJsonText(result.responseLine, `${id}: responseLine`) : undefined,
    auditEvents: result.auditEvents
  };
}

function approvalRuntimeScenario(scenario) {
  if (scenario === "approval-timeout") {
    return {
      approvalTimeoutMs: 1,
      discoveryRequestId: "approval-timeout-tools",
      callRequestId: "approval-timeout-call",
      hook: () => new Promise(() => undefined)
    };
  }
  if (scenario === "approval-rejected-redacted") {
    return {
      discoveryRequestId: "approval-rejected-redacted-tools",
      callRequestId: "approval-rejected-redacted-call",
      hook: () => ({
        approved: false,
        reason: "denied because RAW_APPROVAL_DENIAL_REASON_MARKER touched workspace/private/secret.txt"
      })
    };
  }
  if (scenario === "approval-hook-error") {
    return {
      discoveryRequestId: "approval-hook-error-tools",
      callRequestId: "approval-hook-error-call",
      hook: () => {
        throw new Error("RAW_APPROVAL_HOOK_FAILURE_MARKER");
      }
    };
  }
  throw new Error(`unsupported approval runtime scenario ${scenario}`);
}

function assertJsonEqual(id, actual, expected) {
  checkDecisionEvidenceCodes(`${id}: actual`, actual);
  checkDecisionEvidenceCodes(`${id}: expected`, expected);
  const actualText = stableJson(normalizeOptionalCorrelation(actual, expected));
  const expectedText = stableJson(expected);
  if (actualText !== expectedText) {
    failures.push(`${id}: fixture drifted from current implementation`);
  }
}

function normalizeOptionalCorrelation(actual, expected) {
  if (Array.isArray(actual)) {
    return actual.map((item, index) => normalizeOptionalCorrelation(item, Array.isArray(expected) ? expected[index] : undefined));
  }
  if (!actual || typeof actual !== "object") {
    return actual;
  }
  const normalized = {};
  for (const [key, value] of Object.entries(actual)) {
    if (key === "correlation" && (!expected || typeof expected !== "object" || !(key in expected))) {
      continue;
    }
    const expectedValue = expected && typeof expected === "object" ? expected[key] : undefined;
    if (key === "sessionId" && expectedValue === "<session-id>") {
      normalized[key] = "<session-id>";
    } else if (key === "jsonRpcIdHash" && expectedValue === "<json-rpc-id-hash>") {
      normalized[key] = "<json-rpc-id-hash>";
    } else if ((key === "pendingAgeMs" || key === "durationMs") && expectedValue === "<elapsed-ms>") {
      normalized[key] = "<elapsed-ms>";
    } else {
      normalized[key] = normalizeOptionalCorrelation(value, expectedValue);
    }
  }
  return normalized;
}

function readJson(path) {
  return parseJsonText(readText(path), path);
}

function readText(path) {
  return readFileSync(join(root, path), "utf8");
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    failures.push(`${label}: invalid JSON`);
    return undefined;
  }
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function checkDecisionEvidenceCodes(label, value, path = "$") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      checkDecisionEvidenceCodes(label, item, `${path}[${index}]`);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  if (value.schemaVersion === "msp.decision.v1") {
    if (!Array.isArray(value.evidence)) {
      failures.push(`${label}${path}: decision evidence must be an array`);
    } else {
      for (const [index, evidence] of value.evidence.entries()) {
        if (!evidence || typeof evidence !== "object" || typeof evidence.code !== "string") {
          failures.push(`${label}${path}.evidence[${index}]: decision evidence must include code`);
        }
      }
    }
  }

  for (const [key, item] of Object.entries(value)) {
    checkDecisionEvidenceCodes(label, item, `${path}.${key}`);
  }
}

async function checkCompatibilityEvidenceValidator() {
  const javascriptExternalSpec = externalCompatibilityTargets.get(externalCompatibilityTarget);
  const pythonExternalSpec = externalCompatibilityTargets.get(externalPythonCompatibilityTarget);
  const invalidManifestScopeFailures = collectCompatibilityFailures(() => {
    checkManifestScope("<compatibility-self-test-invalid-manifest-scope>", {
      transport: "http",
      fixtureSource: "external"
    });
  });
  if (
    !invalidManifestScopeFailures.some((item) => item.includes("transport must be stdio")) ||
    !invalidManifestScopeFailures.some((item) => item.includes("fixtureSource must be synthetic-local"))
  ) {
    failures.push(`compatibility self-test invalid manifest scope was not rejected: ${invalidManifestScopeFailures.join("; ")}`);
  }

  const invalidTargetsFailures = collectCompatibilityFailures(() => {
    checkCompatibilityTargets("<compatibility-self-test-invalid-targets>", {
      targets: [
        {
          id: localCompatibilityTarget,
          transport: "http",
          fixtureSource: "external-mcp",
          evidence: "separate"
        },
        {
          id: externalCompatibilityTarget,
          transport: "stdio",
          fixtureSource: "external-mcp",
          client: {
            package: "@modelcontextprotocol/sdk",
            version: "latest"
          },
          server: {
            package: "@modelcontextprotocol/server-filesystem",
            version: "2026.7.4"
          },
          manifest: "../external.manifest.json",
          summary: "fixtures/compatibility/external-filesystem-stdio.summary.json",
          harness: "scripts/check-external-mcp-fixture.mjs",
          validationCommand: ["node", "scripts/not-the-external-fixture.mjs"]
        },
        {
          id: externalPythonCompatibilityTarget,
          transport: "stdio",
          fixtureSource: "external-mcp",
          client: pythonExternalSpec.client,
          server: pythonExternalSpec.server,
          manifest: pythonExternalSpec.manifest,
          summary: pythonExternalSpec.summary,
          harness: pythonExternalSpec.harness,
          validationCommand: ["node", pythonExternalSpec.harness]
        }
      ]
    });
  });
  if (
    !invalidTargetsFailures.some((item) => item.includes("local target transport must be stdio")) ||
    !invalidTargetsFailures.some((item) => item.includes("local target fixtureSource must be synthetic-local")) ||
    !invalidTargetsFailures.some((item) => item.includes("external target client package must be @modelcontextprotocol/sdk@1.29.0")) ||
    !invalidTargetsFailures.some((item) => item.includes("evidence manifest must be a safe repo-relative POSIX path")) ||
    !invalidTargetsFailures.some((item) => item.includes(`external target validationCommand must be node ${javascriptExternalSpec.harness}`))
  ) {
    failures.push(`compatibility self-test invalid targets were not rejected: ${invalidTargetsFailures.join("; ")}`);
  }

  const invalidCliCommandFailures = collectCompatibilityFailures(() => {
    checkCliCommandShape("<compatibility-self-test-invalid-cli-command>", "cli.json.eval-call", [
      "node",
      "scripts/not-the-cli.js",
      "eval-call"
    ]);
  });
  if (!invalidCliCommandFailures.some((item) => item.includes("must invoke node packages/cli/dist/main.js"))) {
    failures.push(`compatibility self-test invalid CLI command was not rejected: ${invalidCliCommandFailures.join("; ")}`);
  }

  const missingCliInputFailures = collectCompatibilityFailures(() => {
    checkCliCommandShape("<compatibility-self-test-missing-cli-input>", "cli.json.eval-call", [
      "node",
      "packages/cli/dist/main.js",
      "eval-call",
      "--policy",
      "fixtures/policies/local-dev.json",
      "--json"
    ]);
  });
  if (!missingCliInputFailures.some((item) => item.includes("CLI evidence command must include --input"))) {
    failures.push(`compatibility self-test missing CLI input was not rejected: ${missingCliInputFailures.join("; ")}`);
  }

  const unsafeCliCommandPathFailures = collectCompatibilityFailures(() => {
    checkCliCommandShape("<compatibility-self-test-unsafe-cli-command-path>", "cli.json.eval-call", [
      "node",
      "packages/cli/dist/main.js",
      "eval-call",
      "--policy",
      "../fixtures/policies/local-dev.json",
      "--input",
      "fixtures/mcp/local-only-call.json",
      "--json"
    ]);
  });
  if (
    !unsafeCliCommandPathFailures.some((item) => item.includes("evidence command --policy must be a safe repo-relative POSIX path")) ||
    !unsafeCliCommandPathFailures.some((item) => item.includes("evidence command --input must reference a tracked file"))
  ) {
    failures.push(
      `compatibility self-test unsafe CLI command path was not rejected: ${unsafeCliCommandPathFailures.join("; ")}`
    );
  }

  const mismatchedCliKindFailures = collectCompatibilityFailures(() => {
    checkCliCommandShape("<compatibility-self-test-cli-kind-mismatch>", "cli.json.check-policy", [
      "node",
      "packages/cli/dist/main.js",
      "eval-call"
    ]);
  });
  if (!mismatchedCliKindFailures.some((item) => item.includes("must run check-policy"))) {
    failures.push(`compatibility self-test CLI kind mismatch was not rejected: ${mismatchedCliKindFailures.join("; ")}`);
  }

  const invalidRuntimeCommandFailures = collectCompatibilityFailures(() => {
    checkRuntimeCommandShape("<compatibility-self-test-runtime-kind-mismatch>", "runtime.live-smoke", ["node", "scripts/not-the-smoke.js"]);
  });
  if (!invalidRuntimeCommandFailures.some((item) => item.includes("must run node scripts/smoke-live-run.mjs"))) {
    failures.push(`compatibility self-test runtime command mismatch was not rejected: ${invalidRuntimeCommandFailures.join("; ")}`);
  }

  const untrackedEvidenceReferenceFailures = collectCompatibilityFailures(() => {
    checkEvidenceReference("<compatibility-self-test-untracked-evidence-reference>", "path", "fixtures/compatibility/local-only.json");
    checkEvidenceReference("<compatibility-self-test-unsafe-evidence-reference>", "policy", "../fixtures/policies/local-dev.json");
  });
  if (
    !untrackedEvidenceReferenceFailures.some((item) => item.includes("evidence path must reference a tracked file")) ||
    !untrackedEvidenceReferenceFailures.some((item) => item.includes("evidence policy must be a safe repo-relative POSIX path"))
  ) {
    failures.push(
      `compatibility self-test unsafe or untracked evidence reference was not rejected: ${untrackedEvidenceReferenceFailures.join("; ")}`
    );
  }

  const missingDecisionCodeFailures = collectCompatibilityFailures(() => {
    checkDecisionEvidenceCodes("<compatibility-self-test-missing-decision-code>", {
      schemaVersion: "msp.decision.v1",
      action: "deny",
      evidence: [{ reason: "operator text is not a stable fixture contract" }]
    });
  });
  if (!missingDecisionCodeFailures.some((item) => item.includes("decision evidence must include code"))) {
    failures.push(
      `compatibility self-test missing decision evidence code was not rejected: ${missingDecisionCodeFailures.join("; ")}`
    );
  }

  const missingRuntimeSessionFailures = await collectCompatibilityFailuresAsync(async () => {
    await checkRuntimeSessionFixture(
      "<compatibility-self-test-runtime-session-missing-fields>",
      "fixtures/compatibility/runtime-approval-timeout.json",
      {
        policy: "fixtures/policies/approval-shell.json",
        profile: "local"
      }
    );
  });
  if (!missingRuntimeSessionFailures.some((item) => item.includes("runtime session evidence must include policy, profile, and scenario"))) {
    failures.push(
      `compatibility self-test missing runtime session fields were not rejected: ${missingRuntimeSessionFailures.join("; ")}`
    );
  }

  const unsupportedRuntimeSessionFailures = await collectCompatibilityFailuresAsync(async () => {
    await checkRuntimeSessionFixture(
      "<compatibility-self-test-runtime-session-unsupported-scenario>",
      "fixtures/compatibility/runtime-approval-timeout.json",
      {
        policy: "fixtures/policies/approval-shell.json",
        profile: "local",
        scenario: "not-supported"
      }
    );
  });
  if (!unsupportedRuntimeSessionFailures.some((item) => item.includes("unsupported runtime session scenario not-supported"))) {
    failures.push(
      `compatibility self-test unsupported runtime session scenario was not rejected: ${unsupportedRuntimeSessionFailures.join("; ")}`
    );
  }

  const invalidPingResponseDriftFailures = await collectCompatibilityFailuresAsync(async () => {
    await checkRuntimeSessionFixture(
      "<compatibility-self-test-runtime-session-invalid-ping-response-drift>",
      "fixtures/compatibility/runtime-approval-timeout.json",
      {
        policy: "fixtures/policies/local-dev.json",
        profile: "local",
        scenario: "server-origin-ping-invalid-response"
      }
    );
  });
  if (!invalidPingResponseDriftFailures.some((item) => item.includes("fixture drifted from current implementation"))) {
    failures.push(
      `compatibility self-test invalid ping response fixture drift was not rejected: ${invalidPingResponseDriftFailures.join("; ")}`
    );
  }
}

function collectCompatibilityFailures(fn) {
  const before = failures.length;
  fn();
  return failures.splice(before);
}

async function collectCompatibilityFailuresAsync(fn) {
  const before = failures.length;
  await fn();
  return failures.splice(before);
}
