import {
  type AuditEvent,
  type Capability,
  type DecisionEvidence,
  type DecisionReasonCode,
  type NormalizedToolCall,
  type PolicyDecision,
  type PolicyDocument,
  type PolicyRule,
  type RedactionSummary
} from "@0disoft/mcp-security-proxy-contracts";
import { classifyToolDescriptor, createAuditEvent, evaluateToolCall } from "@0disoft/mcp-security-proxy-core";
import { evaluateEnvelopeMethod, isJsonRpcRequest, type JsonRpcEnvelope } from "@0disoft/mcp-security-proxy-mcp-adapter";

export interface ProxySessionOptions {
  readonly policy: PolicyDocument;
  readonly profileId: string;
  readonly approvalHookAvailable?: boolean;
  readonly maxFrameBytes?: number;
  readonly maxJsonDepth?: number;
}

export interface ApprovalRequest {
  readonly call: NormalizedToolCall;
  readonly decision: PolicyDecision;
}

export interface ApprovalResult {
  readonly approved: boolean;
  readonly reason?: string;
}

export type ApprovalHook = (request: ApprovalRequest) => ApprovalResult | Promise<ApprovalResult>;

export interface ProxyFrameResult {
  readonly forwardLine?: string;
  readonly responseLine?: string;
  readonly auditEvents: readonly AuditEvent[];
}

interface ToolMetadata {
  readonly name: string;
  readonly title?: string;
  readonly description?: string;
  readonly capabilities: readonly Capability[];
}

const policyDeniedErrorCode = -32001;
const invalidRequestErrorCode = -32600;
const upstreamServerOriginAllowedMethods = new Set(["ping"]);
const requestMethodIdsRequired = new Set(["initialize", "ping", "tools/list", "tools/call"]);
const notificationMethods = new Set(["notifications/initialized"]);
const redactedUpstreamErrorMessage = "upstream error message redacted";
const defaultMaxFrameBytes = 1_048_576;
const defaultMaxJsonDepth = 64;
const discoveryMetadataRedactionKeys = new Set(["default", "example", "examples", "$comment", "_meta"]);

export class ProxySession {
  private readonly pendingRequestMethods = new Map<string, string>();
  private readonly pendingServerOriginMethods = new Map<string, string>();
  private readonly visibleTools = new Map<string, ToolMetadata>();
  private readonly maxFrameBytes: number;
  private readonly maxJsonDepth: number;

  constructor(private readonly options: ProxySessionOptions) {
    this.maxFrameBytes = resolvePositiveInteger(options.maxFrameBytes, defaultMaxFrameBytes);
    this.maxJsonDepth = resolvePositiveInteger(options.maxJsonDepth, defaultMaxJsonDepth);
  }

  handleClientLine(line: string): ProxyFrameResult {
    const prepared = this.prepareClientLine(line);
    if (prepared.kind === "result") {
      return prepared.result;
    }
    return this.handlePreparedClientRequest(prepared.line, prepared.envelope);
  }

  async handleClientLineWithApproval(line: string, approvalHook: ApprovalHook): Promise<ProxyFrameResult> {
    const prepared = this.prepareClientLine(line);
    if (prepared.kind === "result") {
      return prepared.result;
    }
    return this.handlePreparedClientRequestWithApproval(prepared.line, prepared.envelope, approvalHook);
  }

  private prepareClientLine(
    line: string
  ): { readonly kind: "result"; readonly result: ProxyFrameResult } | { readonly kind: "request"; readonly line: string; readonly envelope: JsonRpcEnvelope } {
    const parsed = parseJsonLine(line, this.maxFrameBytes, this.maxJsonDepth);
    if (!parsed.ok) {
      const decision = denyDecision(parsed.reason, { code: parsed.code });
      return {
        kind: "result",
        result: {
          responseLine: encodeJsonRpcError(null, invalidRequestErrorCode, "invalid MCP JSON-RPC message", decision),
          auditEvents: [this.createAudit("error", decision)]
        }
      };
    }

    const envelope = parsed.value;
    if (!isJsonRpcRequest(envelope)) {
      const serverOriginMethod = this.takePendingServerOriginMethod(envelope);
      if (!serverOriginMethod) {
        return {
          kind: "result",
          result: {
            auditEvents: [
              this.createAudit(
                "error",
                denyDecision("client JSON-RPC response did not match a pending upstream server request", { code: "jsonrpc.unmatched_response" })
              )
            ]
          }
        };
      }
      if (serverOriginMethod === "ping" && !isEmptyPingResponse(envelope)) {
        return {
          kind: "result",
          result: {
            auditEvents: [
              this.createAudit(
                "error",
                denyDecision("client response to server-origin ping must be an empty result", {
                  code: "jsonrpc.invalid",
                  method: serverOriginMethod
                })
              )
            ]
          }
        };
      }

      return {
        kind: "result",
        result: {
          forwardLine: line,
          auditEvents: []
        }
      };
    }

    const methodDecision = evaluateEnvelopeMethod(envelope, this.options.policy);
    if (methodDecision.action !== "allow") {
      return {
        kind: "result",
        result: this.denyEnvelope(envelope, methodDecision, "MCP method denied by policy", "method-denied")
      };
    }

    const shapeDenied = this.denyInvalidMethodShape(envelope);
    if (shapeDenied) {
      return {
        kind: "result",
        result: shapeDenied
      };
    }

    const duplicatePending = this.denyDuplicatePendingRequest(
      envelope,
      this.pendingRequestMethods,
      "client JSON-RPC request id already has a pending upstream response"
    );
    if (duplicatePending) {
      return {
        kind: "result",
        result: duplicatePending
      };
    }

    if (envelope.method !== "tools/call") {
      this.rememberPendingRequest(envelope);
      return {
        kind: "result",
        result: {
          forwardLine: line,
          auditEvents: []
        }
      };
    }

    return { kind: "request", line, envelope };
  }

  private handlePreparedClientRequest(line: string, envelope: JsonRpcEnvelope): ProxyFrameResult {
    const toolName = readToolCallName(envelope);
    const visibleTool = this.visibleTools.get(toolName);
    if (!visibleTool) {
      return this.denyEnvelope(
        envelope,
        denyDecision("tool was not visible in filtered discovery", { code: "tool.not_visible" }),
        "MCP tool call denied by policy",
        "call-decision",
        toolName || undefined
      );
    }

    const normalized = normalizeToolCall(envelope, visibleTool);
    const decision = evaluateToolCall({
      policy: this.options.policy,
      profileId: this.options.profileId,
      call: normalized,
      ...(this.options.approvalHookAvailable !== undefined ? { approvalHookAvailable: this.options.approvalHookAvailable } : {})
    });

    if (decision.action === "allow") {
      this.rememberPendingRequest(envelope);
      return {
        forwardLine: line,
        auditEvents: [this.createAudit("call-decision", decision, normalized.toolName)]
      };
    }

    if (decision.action === "approval_required") {
      return this.denyEnvelope(
        envelope,
        denyDecision("approval required but no approval hook is available in this runtime path", {
          code: "policy.approval_hook_missing",
          ...approvalEvidence(decision)
        }),
        "MCP tool call denied by policy",
        "call-decision",
        normalized.toolName
      );
    }

    return this.denyEnvelope(envelope, decision, "MCP tool call denied by policy", "call-decision", normalized.toolName);
  }

  private async handlePreparedClientRequestWithApproval(
    line: string,
    envelope: JsonRpcEnvelope,
    approvalHook: ApprovalHook
  ): Promise<ProxyFrameResult> {
    const toolName = readToolCallName(envelope);
    const visibleTool = this.visibleTools.get(toolName);
    if (!visibleTool) {
      return this.denyEnvelope(
        envelope,
        denyDecision("tool was not visible in filtered discovery", { code: "tool.not_visible" }),
        "MCP tool call denied by policy",
        "call-decision",
        toolName || undefined
      );
    }

    const normalized = normalizeToolCall(envelope, visibleTool);
    const decision = evaluateToolCall({
      policy: this.options.policy,
      profileId: this.options.profileId,
      call: normalized,
      approvalHookAvailable: true
    });

    if (decision.action === "allow") {
      this.rememberPendingRequest(envelope);
      return {
        forwardLine: line,
        auditEvents: [this.createAudit("call-decision", decision, normalized.toolName)]
      };
    }

    if (decision.action !== "approval_required") {
      return this.denyEnvelope(envelope, decision, "MCP tool call denied by policy", "call-decision", normalized.toolName);
    }

    let approval: ApprovalResult;
    try {
      approval = await approvalHook({ call: normalized, decision });
    } catch {
      return this.denyEnvelope(
        envelope,
        denyDecision("approval hook failed closed", {
          code: "policy.approval_hook_failed",
          ...approvalEvidence(decision)
        }),
        "MCP tool call denied by policy",
        "call-decision",
        normalized.toolName
      );
    }

    if (approval.approved) {
      this.rememberPendingRequest(envelope);
      return {
        forwardLine: line,
        auditEvents: [this.createAudit("call-decision", decision, normalized.toolName)]
      };
    }

    return this.denyEnvelope(
      envelope,
      denyDecision(approval.reason || "approval required call rejected by approval hook", {
        code: "policy.approval_denied",
        ...approvalEvidence(decision)
      }),
      "MCP tool call denied by policy",
      "call-decision",
      normalized.toolName
    );
  }

  handleServerLine(line: string): ProxyFrameResult {
    const parsed = parseJsonLine(line, this.maxFrameBytes, this.maxJsonDepth);
    if (!parsed.ok) {
      const decision = denyDecision(parsed.reason, { code: parsed.code });
      return {
        auditEvents: [this.createAudit("error", decision)]
      };
    }

    const envelope = parsed.value;
    if (isJsonRpcRequest(envelope)) {
      const methodDecision = evaluateServerOriginMethod(envelope, this.options.policy);
      if (methodDecision.action !== "allow") {
        return this.denyEnvelope(envelope, methodDecision, "MCP method denied by policy", "method-denied");
      }

      const shapeDenied = this.denyInvalidServerOriginMethodShape(envelope);
      if (shapeDenied) {
        return shapeDenied;
      }

      const duplicatePending = this.denyDuplicatePendingRequest(
        envelope,
        this.pendingServerOriginMethods,
        "upstream server JSON-RPC request id already has a pending client response"
      );
      if (duplicatePending) {
        return duplicatePending;
      }

      this.rememberPendingServerOriginRequest(envelope);
      return {
        forwardLine: line,
        auditEvents: []
      };
    }

    const sanitized = sanitizeUpstreamError(envelope);
    const sanitizeAuditEvents = sanitized.redaction.applied
      ? [
          this.createAudit(
            "error",
            denyDecision(upstreamErrorRedactionReason(sanitized.redaction), { code: upstreamErrorRedactionCode(sanitized.redaction) }),
            undefined,
            undefined,
            sanitized.redaction
          )
        ]
      : [];
    const responseLine = sanitized.redaction.applied ? JSON.stringify(sanitized.envelope) : line;

    const requestMethod = this.takePendingMethod(sanitized.envelope);
    if (!requestMethod) {
      return {
        auditEvents: [
          ...sanitizeAuditEvents,
          this.createAudit(
            "error",
            denyDecision("upstream JSON-RPC response did not match a pending client request", { code: "jsonrpc.unmatched_response" })
          )
        ]
      };
    }

    if (requestMethod !== "tools/list") {
      return {
        forwardLine: responseLine,
        auditEvents: sanitizeAuditEvents
      };
    }

    if ("error" in sanitized.envelope) {
      this.visibleTools.clear();
      return {
        forwardLine: responseLine,
        auditEvents: sanitizeAuditEvents
      };
    }

    const result = filterToolListResult(sanitized.envelope, this.options.policy, this.options.profileId);
    this.visibleTools.clear();
    for (const tool of result.visibleTools) {
      this.visibleTools.set(tool.name, tool);
    }

    return {
      forwardLine: JSON.stringify(result.envelope),
      auditEvents: [...sanitizeAuditEvents, ...this.createDiscoveryAuditEvents(result.filteredCount, result.sanitizedMalformedResult)]
    };
  }

  private takePendingMethod(envelope: JsonRpcEnvelope): string | undefined {
    if (envelope.id === undefined) {
      return undefined;
    }
    const key = requestIdKey(envelope.id);
    const method = this.pendingRequestMethods.get(key);
    this.pendingRequestMethods.delete(key);
    return method;
  }

  private rememberPendingRequest(envelope: JsonRpcEnvelope): void {
    if (envelope.id === undefined || typeof envelope.method !== "string") {
      return;
    }
    this.pendingRequestMethods.set(requestIdKey(envelope.id), envelope.method);
  }

  private takePendingServerOriginMethod(envelope: JsonRpcEnvelope): string | undefined {
    if (envelope.id === undefined) {
      return undefined;
    }
    const key = requestIdKey(envelope.id);
    const method = this.pendingServerOriginMethods.get(key);
    this.pendingServerOriginMethods.delete(key);
    return method;
  }

  private rememberPendingServerOriginRequest(envelope: JsonRpcEnvelope): void {
    if (envelope.id === undefined || typeof envelope.method !== "string") {
      return;
    }
    this.pendingServerOriginMethods.set(requestIdKey(envelope.id), envelope.method);
  }

  private denyDuplicatePendingRequest(
    envelope: JsonRpcEnvelope,
    pending: ReadonlyMap<string, string>,
    reason: string
  ): ProxyFrameResult | undefined {
    if (envelope.id === undefined || !pending.has(requestIdKey(envelope.id))) {
      return undefined;
    }
    return this.denyEnvelope(
      envelope,
      denyDecision(reason, {
        code: "jsonrpc.invalid",
        ...(typeof envelope.method === "string" ? { method: envelope.method } : {})
      }),
      "MCP request denied by proxy protocol state",
      "error"
    );
  }

  private denyInvalidMethodShape(envelope: JsonRpcEnvelope): ProxyFrameResult | undefined {
    if (requestMethodIdsRequired.has(envelope.method ?? "") && envelope.id === undefined) {
      return this.denyInvalidClientMessage(
        envelope,
        "MCP request method must include a JSON-RPC id",
        "MCP request denied by proxy protocol state"
      );
    }
    if (notificationMethods.has(envelope.method ?? "") && envelope.id !== undefined) {
      return this.denyInvalidClientMessage(
        envelope,
        "MCP notification method must not include a JSON-RPC id",
        "MCP notification denied by proxy protocol state"
      );
    }
    return undefined;
  }

  private denyInvalidServerOriginMethodShape(envelope: JsonRpcEnvelope): ProxyFrameResult | undefined {
    if (envelope.method === "ping" && envelope.id === undefined) {
      return this.denyEnvelope(
        envelope,
        denyDecision("server-origin ping must include a JSON-RPC id", { code: "jsonrpc.invalid", method: envelope.method }),
        "MCP method denied by policy",
        "method-denied"
      );
    }
    return undefined;
  }

  private denyInvalidClientMessage(envelope: JsonRpcEnvelope, reason: string, message: string): ProxyFrameResult {
    const decision = denyDecision(reason, {
      code: "jsonrpc.invalid",
      ...(typeof envelope.method === "string" ? { method: envelope.method } : {})
    });
    return {
      responseLine: encodeJsonRpcError(envelope.id ?? null, invalidRequestErrorCode, message, decision),
      auditEvents: [this.createAudit("error", decision, undefined, envelope.method)]
    };
  }

  private denyEnvelope(
    envelope: JsonRpcEnvelope,
    decision: PolicyDecision,
    message: string,
    kind: "method-denied" | "call-decision" | "error",
    toolName?: string
  ): ProxyFrameResult {
    const auditEvent = this.createAudit(kind, decision, toolName, envelope.method);
    if (envelope.id === undefined) {
      return {
        auditEvents: [auditEvent]
      };
    }

    return {
      responseLine: encodeJsonRpcError(envelope.id, policyDeniedErrorCode, message, decision),
      auditEvents: [auditEvent]
    };
  }

  private createAudit(
    kind: AuditEvent["kind"],
    decision: PolicyDecision,
    toolName?: string,
    method?: string,
    redaction: RedactionSummary = noRedaction()
  ): AuditEvent {
    return createAuditEvent({
      kind,
      profileId: this.options.profileId,
      decision,
      redaction,
      ...(toolName ? { toolName } : {}),
      ...(method ? { method } : {})
    });
  }

  private createDiscoveryAuditEvents(filteredCount: number, sanitizedMalformedResult: boolean): readonly AuditEvent[] {
    const events: AuditEvent[] = [];
    if (sanitizedMalformedResult) {
      events.push(
        this.createAudit(
          "discovery-filtered",
          denyDecision("malformed tool discovery result sanitized to an empty tool list", { code: "discovery.filtered" })
        )
      );
    }
    if (filteredCount > 0) {
      events.push(
        this.createAudit("discovery-filtered", denyDecision(`${filteredCount} tool(s) hidden by discovery policy`, { code: "discovery.filtered" }))
      );
    }
    return events;
  }
}

export function createProxySession(options: ProxySessionOptions): ProxySession {
  return new ProxySession(options);
}

function parseJsonLine(
  line: string,
  maxFrameBytes: number,
  maxJsonDepth: number
):
  | { readonly ok: true; readonly value: JsonRpcEnvelope }
  | { readonly ok: false; readonly reason: string; readonly code: DecisionReasonCode } {
  if (Buffer.byteLength(line, "utf8") > maxFrameBytes) {
    return { ok: false, reason: `JSON-RPC frame exceeds maximum size of ${maxFrameBytes} bytes`, code: "jsonrpc.frame_too_large" };
  }
  if (line.includes("\n") || line.includes("\r")) {
    return { ok: false, reason: "stdio MCP messages must be newline-delimited without embedded newlines", code: "jsonrpc.invalid" };
  }

  try {
    const parsed = JSON.parse(line) as unknown;
    if (jsonDepthExceeds(parsed, maxJsonDepth)) {
      return { ok: false, reason: `JSON-RPC message exceeds maximum depth of ${maxJsonDepth}`, code: "jsonrpc.too_deep" };
    }
    if (!isRecord(parsed) || parsed["jsonrpc"] !== "2.0") {
      return { ok: false, reason: "message is not a JSON-RPC 2.0 object", code: "jsonrpc.invalid" };
    }
    if ("id" in parsed && !isJsonRpcId(parsed["id"])) {
      return { ok: false, reason: "JSON-RPC id must be a string, number, null, or absent", code: "jsonrpc.invalid" };
    }
    if ("method" in parsed && typeof parsed["method"] !== "string") {
      return { ok: false, reason: "JSON-RPC method must be a string when present", code: "jsonrpc.invalid" };
    }
    const hasMethod = "method" in parsed;
    const hasResult = "result" in parsed;
    const hasError = "error" in parsed;
    if (hasMethod && (hasResult || hasError)) {
      return { ok: false, reason: "JSON-RPC request or notification must not include result or error", code: "jsonrpc.invalid" };
    }
    if (!hasMethod) {
      if (!("id" in parsed)) {
        return { ok: false, reason: "JSON-RPC response must include an id", code: "jsonrpc.invalid" };
      }
      if (hasResult === hasError) {
        return { ok: false, reason: "JSON-RPC response must include exactly one of result or error", code: "jsonrpc.invalid" };
      }
      if (hasError && !isJsonRpcErrorObject(parsed["error"])) {
        return { ok: false, reason: "JSON-RPC error must include numeric code and string message", code: "jsonrpc.invalid" };
      }
    }
    return { ok: true, value: parsed as unknown as JsonRpcEnvelope };
  } catch {
    return { ok: false, reason: "message is not valid JSON", code: "jsonrpc.invalid" };
  }
}

function jsonDepthExceeds(value: unknown, maxDepth: number): boolean {
  const stack: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 1 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    if (current.depth > maxDepth) {
      return true;
    }
    if (!isRecord(current.value) && !Array.isArray(current.value)) {
      continue;
    }
    for (const child of Array.isArray(current.value) ? current.value : Object.values(current.value)) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return false;
}

function isJsonRpcId(value: unknown): value is string | number | null {
  return value === null || typeof value === "string" || typeof value === "number";
}

function isJsonRpcErrorObject(value: unknown): boolean {
  return isRecord(value) && typeof value["code"] === "number" && typeof value["message"] === "string";
}

function sanitizeUpstreamError(envelope: JsonRpcEnvelope): { readonly envelope: JsonRpcEnvelope; readonly redaction: RedactionSummary } {
  if (!isRecord(envelope.error)) {
    return { envelope, redaction: noRedaction() };
  }

  const error = { ...envelope.error };
  const counts: Record<string, number> = {};
  if ("data" in error) {
    delete error["data"];
    counts["jsonrpc_error_data"] = 1;
  }

  if (typeof error["message"] === "string" && looksSensitiveErrorMessage(error["message"])) {
    error["message"] = redactedUpstreamErrorMessage;
    counts["jsonrpc_error_message"] = 1;
  }

  if (Object.keys(counts).length === 0) {
    return { envelope, redaction: noRedaction() };
  }

  return {
    envelope: {
      ...envelope,
      error
    },
    redaction: {
      applied: true,
      counts
    }
  };
}

function upstreamErrorRedactionReason(redaction: RedactionSummary): string {
  const removedData = redaction.counts["jsonrpc_error_data"] !== undefined;
  const redactedMessage = redaction.counts["jsonrpc_error_message"] !== undefined;
  if (removedData && redactedMessage) {
    return "upstream JSON-RPC error data removed and message redacted before forwarding";
  }
  if (redactedMessage) {
    return "upstream JSON-RPC error message redacted before forwarding";
  }
  return "upstream JSON-RPC error data removed before forwarding";
}

function upstreamErrorRedactionCode(redaction: RedactionSummary): DecisionReasonCode {
  const removedData = redaction.counts["jsonrpc_error_data"] !== undefined;
  const redactedMessage = redaction.counts["jsonrpc_error_message"] !== undefined;
  if (removedData && redactedMessage) {
    return "jsonrpc.upstream_error_redacted";
  }
  if (redactedMessage) {
    return "jsonrpc.upstream_error_message_redacted";
  }
  return "jsonrpc.upstream_error_data_redacted";
}

function readToolCallName(envelope: JsonRpcEnvelope): string {
  const params = isRecord(envelope.params) ? envelope.params : {};
  return typeof params["name"] === "string" ? params["name"] : "";
}

function normalizeToolCall(envelope: JsonRpcEnvelope, visibleTool: ToolMetadata): NormalizedToolCall {
  const params = isRecord(envelope.params) ? envelope.params : {};
  return {
    method: "tools/call",
    toolName: visibleTool.name,
    capabilities: visibleTool.capabilities,
    argumentFacts: extractArgumentFacts(params["arguments"])
  };
}

function extractArgumentFacts(value: unknown): NormalizedToolCall["argumentFacts"] {
  const facts: NormalizedToolCall["argumentFacts"][number][] = [];
  collectArgumentFacts(value, facts);
  return facts;
}

function collectArgumentFacts(value: unknown, facts: NormalizedToolCall["argumentFacts"][number][]): void {
  if (typeof value === "string") {
    if (looksLikeUrl(value)) {
      facts.push({ kind: "network", value });
      return;
    }
    if (looksLikePath(value)) {
      facts.push({ kind: "path", value });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectArgumentFacts(item, facts);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const executable = value["executable"];
  const argv = value["argv"];
  if (typeof executable === "string" && Array.isArray(argv) && argv.every((item) => typeof item === "string")) {
    facts.push({ kind: "command", executable, argv });
  }

  for (const entry of Object.values(value)) {
    collectArgumentFacts(entry, facts);
  }
}

function filterToolListResult(
  envelope: JsonRpcEnvelope,
  policy: PolicyDocument,
  profileId: string
): {
  readonly envelope: JsonRpcEnvelope;
  readonly visibleTools: readonly ToolMetadata[];
  readonly filteredCount: number;
  readonly sanitizedMalformedResult: boolean;
} {
  const result = isRecord(envelope.result) ? envelope.result : undefined;
  const tools = Array.isArray(result?.["tools"]) ? result["tools"] : undefined;
  if (!result || !tools) {
    return {
      envelope: {
        ...envelope,
        result: {
          tools: []
        }
      },
      visibleTools: [],
      filteredCount: 0,
      sanitizedMalformedResult: true
    };
  }

  const visibleTools: ToolMetadata[] = [];
  const filteredTools: unknown[] = [];
  const forwardedToolNames = new Set<string>();
  for (const item of tools) {
    if (!isRecord(item) || typeof item["name"] !== "string") {
      continue;
    }
    const description = typeof item["description"] === "string" ? item["description"] : undefined;
    const title = typeof item["title"] === "string" ? item["title"] : undefined;
    const classified = classifyToolDescriptor({
      name: item["name"],
      ...(description ? { description } : {})
    }).descriptor;
    const metadata: ToolMetadata = {
      name: classified.name,
      ...(title ? { title } : {}),
      ...(classified.description ? { description: classified.description } : {}),
      capabilities: classified.capabilities
    };

    if (toolIsDiscoverable(metadata, policy, profileId)) {
      if (forwardedToolNames.has(metadata.name)) {
        continue;
      }
      forwardedToolNames.add(metadata.name);
      visibleTools.push(metadata);
      filteredTools.push(sanitizeVisibleToolDescriptor(item, metadata));
    }
  }

  return {
    envelope: {
      ...envelope,
      result: sanitizeToolListResult(result, filteredTools)
    },
    visibleTools,
    filteredCount: tools.length - filteredTools.length,
    sanitizedMalformedResult: false
  };
}

function sanitizeVisibleToolDescriptor(item: Readonly<Record<string, unknown>>, metadata: ToolMetadata): Readonly<Record<string, unknown>> {
  const descriptor: Record<string, unknown> = {
    name: metadata.name
  };

  if (metadata.description) {
    descriptor["description"] = metadata.description;
  }
  if (metadata.title) {
    descriptor["title"] = metadata.title;
  }

  copyRecordField(item, descriptor, "inputSchema");
  copyRecordField(item, descriptor, "outputSchema");
  copyRecordField(item, descriptor, "annotations");

  return descriptor;
}

function sanitizeToolListResult(result: Readonly<Record<string, unknown>>, tools: readonly unknown[]): Readonly<Record<string, unknown>> {
  const sanitized: Record<string, unknown> = {
    tools
  };
  if (typeof result["nextCursor"] === "string") {
    sanitized["nextCursor"] = result["nextCursor"];
  }
  return sanitized;
}

function copyRecordField(source: Readonly<Record<string, unknown>>, target: Record<string, unknown>, field: string): void {
  const value = source[field];
  if (isRecord(value)) {
    target[field] = sanitizeDiscoveryMetadata(value);
  }
}

function sanitizeDiscoveryMetadata(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const sanitized = sanitizeDiscoveryMetadataValue(value);
  return isRecord(sanitized) ? sanitized : {};
}

function sanitizeDiscoveryMetadataValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiscoveryMetadataValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (discoveryMetadataRedactionKeys.has(key)) {
      continue;
    }
    sanitized[key] = sanitizeDiscoveryMetadataValue(item);
  }
  return sanitized;
}

function toolIsDiscoverable(tool: ToolMetadata, policy: PolicyDocument, profileId: string): boolean {
  if (tool.capabilities.includes("unknown")) {
    return false;
  }

  const profile = policy.profiles.find((item) => item.id === profileId);
  if (!profile) {
    return false;
  }

  return profile.rules.some((rule) => {
    if (rule.action === "deny") {
      return false;
    }
    return ruleCoversTool(rule, tool);
  });
}

function ruleCoversTool(rule: PolicyRule, tool: ToolMetadata): boolean {
  return Boolean(rule.tools?.includes(tool.name)) || tool.capabilities.some((capability) => rule.capabilities?.includes(capability));
}

function encodeJsonRpcError(id: string | number | null, code: number, message: string, decision: PolicyDecision): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data: {
        decision
      }
    }
  });
}

function requestIdKey(id: string | number | null): string {
  if (id === null) {
    return "null:null";
  }
  return `${typeof id}:${String(id)}`;
}

function evaluateServerOriginMethod(envelope: JsonRpcEnvelope & { readonly method: string }, policy: PolicyDocument): PolicyDecision {
  const policyDecision = evaluateEnvelopeMethod(envelope, policy);
  if (policyDecision.action !== "allow") {
    return policyDecision;
  }

  if (!upstreamServerOriginAllowedMethods.has(envelope.method)) {
    return denyDecision("MCP method is not allowed from upstream server", {
      code: "method.server_origin_disallowed",
      method: envelope.method
    });
  }

  if (envelope.method === "ping" && !hasNoParamsOrEmptyObjectParams(envelope)) {
    return denyDecision("server-origin ping must not carry params", {
      code: "method.server_origin_ping_params",
      method: envelope.method
    });
  }

  return policyDecision;
}

function hasNoParamsOrEmptyObjectParams(envelope: JsonRpcEnvelope): boolean {
  if (envelope.params === undefined) {
    return true;
  }
  return isRecord(envelope.params) && Object.keys(envelope.params).length === 0;
}

function isEmptyPingResponse(envelope: JsonRpcEnvelope): boolean {
  return isRecord(envelope.result) && Object.keys(envelope.result).length === 0 && envelope.error === undefined;
}

function denyDecision(reason: string, evidence?: Omit<DecisionEvidence, "reason">): PolicyDecision {
  return {
    schemaVersion: "msp.decision.v1",
    action: "deny",
    evidence: [{ ...evidence, reason }]
  };
}

function approvalEvidence(decision: PolicyDecision): Omit<DecisionEvidence, "code" | "reason"> {
  const first = decision.evidence[0];
  if (!first) {
    return {};
  }
  return {
    ...(first.ruleId ? { ruleId: first.ruleId } : {}),
    ...(first.capability ? { capability: first.capability } : {}),
    ...(first.method ? { method: first.method } : {})
  };
}

function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isSafeInteger(value) || value < 1) {
    return fallback;
  }
  return value;
}

function noRedaction(): RedactionSummary {
  return {
    applied: false,
    counts: {}
  };
}

function looksLikePath(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksSensitiveErrorMessage(value: string): boolean {
  return looksLikeUrl(value) || looksLikePathInMessage(value) || /REDACT_ME[A-Z0-9_]*/.test(value);
}

function looksLikePathInMessage(value: string): boolean {
  return (
    /(?:^|\s)[A-Za-z]:[\\/]\S+/.test(value) ||
    /(?:^|\s)(?:\.{1,2}|~|workspace|home|users?|tmp|temp|private|secrets?)[\\/]\S+/i.test(value) ||
    /(?:^|\s)\S+[\\/]\S*\.[A-Za-z0-9]{1,12}(?:\s|$)/.test(value)
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
