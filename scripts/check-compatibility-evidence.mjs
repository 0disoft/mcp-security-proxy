import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const manifestPath = "fixtures/compatibility/manifest.json";
const requiredKinds = new Set([
  "mcp.discovery",
  "mcp.call.allowed",
  "mcp.call.denied",
  "mcp.call.approval-required",
  "audit.redaction",
  "cli.json.check-policy",
  "cli.json.inspect-tools",
  "cli.json.eval-call",
  "library.decision-result",
  "runtime.live-smoke",
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
  "runtime-live-stdio-smoke",
  "runtime-approval-rejected-redacted",
  "runtime-approval-hook-error",
  "runtime-approval-timeout",
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
  "runtime-server-envelope-sanitization",
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

if (manifest.target !== "local-stdio-mvp") {
  failures.push(`${manifestPath}: target must be local-stdio-mvp`);
}
checkManifestScope(manifestPath, manifest);

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

  if (kind.startsWith("mcp.") || kind.startsWith("cli.") || kind.startsWith("library.")) {
    readJson(path);
  }
  if (kind === "audit.redaction") {
    checkAuditRedactionFixture(id, path);
  }
  if (kind.startsWith("cli.")) {
    checkCliFixture(id, kind, path, item.command);
  }
  if (kind === "library.decision-result") {
    await checkLibraryDecisionFixture(id, path, item);
  }
  if (kind === "runtime.session-result") {
    await checkRuntimeSessionFixture(id, path, item);
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

async function checkRuntimeSessionFixture(id, path, item) {
  if (typeof item.policy !== "string" || typeof item.profile !== "string" || typeof item.scenario !== "string") {
    failures.push(`${id}: runtime session evidence must include policy, profile, and scenario`);
    return;
  }
  const supportedScenarios = new Set([
    "approval-hook-error",
    "approval-rejected-redacted",
    "approval-timeout",
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
    "server-envelope-sanitization",
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
        : undefined,
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
  const actualText = stableJson(actual);
  const expectedText = stableJson(expected);
  if (actualText !== expectedText) {
    failures.push(`${id}: fixture drifted from current implementation`);
  }
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
