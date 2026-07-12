import {
  type AuditEvent,
  type Capability,
  type DecisionEvidence,
  type DecisionReasonCode,
  type NormalizedToolCall,
  type PolicyDecision,
  type PolicyDocument,
  type RedactionSummary
} from "@0disoft/mcp-security-proxy-contracts";
import {
  classifyToolDescriptor,
  createAuditEvent,
  evaluateToolCall,
  redactText,
  toolHasNonDenyPolicyCoverage
} from "@0disoft/mcp-security-proxy-core";
import {
  evaluateEnvelopeMethod,
  isJsonRpcErrorResponse,
  isJsonRpcRequest,
  normalizeToolCallEnvelope,
  type JsonRpcEnvelope,
  type JsonRpcErrorObject,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse
} from "@0disoft/mcp-security-proxy-mcp-adapter";

export interface ProxySessionOptions {
  readonly policy: PolicyDocument;
  readonly profileId: string;
  readonly approvalHookAvailable?: boolean;
  readonly approvalTimeoutMs?: number;
  readonly maxFrameBytes?: number;
  readonly maxJsonDepth?: number;
  readonly maxPendingRequests?: number;
  readonly pendingRequestTtlMs?: number;
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

interface PendingRequestState {
  readonly method: string;
  readonly expiresAt: number;
  readonly continuesDiscovery?: boolean;
}

type JsonRpcRequestEnvelope = JsonRpcRequest | JsonRpcNotification;

const policyDeniedErrorCode = -32001;
const invalidRequestErrorCode = -32600;
const upstreamServerOriginAllowedMethods = new Set(["ping"]);
const requestMethodIdsRequired = new Set(["initialize", "ping", "tools/list", "tools/call"]);
const notificationMethods = new Set(["notifications/initialized"]);
const redactedUpstreamErrorMessage = "upstream error message redacted";
const defaultMaxFrameBytes = 1_048_576;
const defaultMaxJsonDepth = 64;
const defaultMaxPendingRequests = 1_024;
const defaultPendingRequestTtlMs = 300_000;
const defaultApprovalTimeoutMs = 30_000;
const discoveryMetadataRedactionKeys = new Set(["default", "example", "examples", "$comment", "_meta"]);
const jsonRpcRequestEnvelopeKeys = new Set(["jsonrpc", "id", "method", "params"]);
const jsonRpcResponseEnvelopeKeys = new Set(["jsonrpc", "id", "result", "error"]);
const toolCallParamKeys = new Set(["name", "arguments"]);

export class ProxySession {
  private readonly pendingRequestMethods = new Map<string, PendingRequestState>();
  private readonly pendingServerOriginMethods = new Map<string, PendingRequestState>();
  private readonly visibleTools = new Map<string, ToolMetadata>();
  private readonly maxFrameBytes: number;
  private readonly maxJsonDepth: number;
  private readonly maxPendingRequests: number;
  private readonly pendingRequestTtlMs: number;
  private readonly approvalTimeoutMs: number;

  constructor(private readonly options: ProxySessionOptions) {
    this.maxFrameBytes = resolvePositiveInteger(options.maxFrameBytes, defaultMaxFrameBytes);
    this.maxJsonDepth = resolvePositiveInteger(options.maxJsonDepth, defaultMaxJsonDepth);
    this.maxPendingRequests = resolvePositiveInteger(options.maxPendingRequests, defaultMaxPendingRequests);
    this.pendingRequestTtlMs = resolvePositiveInteger(options.pendingRequestTtlMs, defaultPendingRequestTtlMs);
    this.approvalTimeoutMs = resolvePositiveInteger(options.approvalTimeoutMs, defaultApprovalTimeoutMs);
  }

  handleClientLine(line: string): ProxyFrameResult {
    const prepared = this.prepareClientLine(line);
    if (prepared.kind === "result") {
      return prepared.result;
    }
    return this.handlePreparedClientRequest(prepared.line, prepared.envelope, prepared.auditEvents);
  }

  async handleClientLineWithApproval(line: string, approvalHook: ApprovalHook): Promise<ProxyFrameResult> {
    const prepared = this.prepareClientLine(line);
    if (prepared.kind === "result") {
      return prepared.result;
    }
    return this.handlePreparedClientRequestWithApproval(prepared.line, prepared.envelope, approvalHook, prepared.auditEvents);
  }

  private prepareClientLine(
    line: string
  ):
    | { readonly kind: "result"; readonly result: ProxyFrameResult }
    | { readonly kind: "request"; readonly line: string; readonly envelope: JsonRpcRequestEnvelope; readonly auditEvents: readonly AuditEvent[] } {
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

      const sanitized = sanitizeJsonRpcResponseEnvelope(envelope);
      return {
        kind: "result",
        result: {
          forwardLine: sanitized.redaction.applied ? JSON.stringify(sanitized.envelope) : line,
          auditEvents: this.createResponseEnvelopeRedactionAuditEvents("client", sanitized.redaction)
        }
      };
    }

    const requestSanitized = sanitizeJsonRpcRequestEnvelope(envelope);
    const requestSanitizeAuditEvents = this.createRequestEnvelopeRedactionAuditEvents("client", requestSanitized.redaction);
    const methodDecision = evaluateEnvelopeMethod(requestSanitized.envelope, this.options.policy);
    if (methodDecision.action !== "allow") {
      return {
        kind: "result",
        result: this.withPrependedAuditEvents(
          requestSanitizeAuditEvents,
          this.denyEnvelope(requestSanitized.envelope, methodDecision, "MCP method denied by policy", "method-denied")
        )
      };
    }

    const shapeDenied = this.denyInvalidMethodShape(requestSanitized.envelope);
    if (shapeDenied) {
      return {
        kind: "result",
        result: this.withPrependedAuditEvents(requestSanitizeAuditEvents, shapeDenied)
      };
    }

    const duplicatePending = this.denyDuplicatePendingRequest(
      requestSanitized.envelope,
      this.pendingRequestMethods,
      "client JSON-RPC request id already has a pending upstream response"
    );
    if (duplicatePending) {
      return {
        kind: "result",
        result: this.withPrependedAuditEvents(requestSanitizeAuditEvents, duplicatePending)
      };
    }

    const forwardLine = requestSanitized.redaction.applied ? JSON.stringify(requestSanitized.envelope) : line;
    if (requestSanitized.envelope.method !== "tools/call") {
      const concurrentDiscoveryDenied = this.denyConcurrentDiscoveryRequest(requestSanitized.envelope);
      if (concurrentDiscoveryDenied) {
        return {
          kind: "result",
          result: this.withPrependedAuditEvents(requestSanitizeAuditEvents, concurrentDiscoveryDenied)
        };
      }
      const pendingDenied = this.denyPendingCapacityExceeded(requestSanitized.envelope, this.pendingRequestMethods, "client");
      if (pendingDenied) {
        return {
          kind: "result",
          result: this.withPrependedAuditEvents(requestSanitizeAuditEvents, pendingDenied)
        };
      }
      this.rememberPendingRequest(requestSanitized.envelope);
      return {
        kind: "result",
        result: {
          forwardLine,
          auditEvents: requestSanitizeAuditEvents
        }
      };
    }

    const toolCallParamsSanitized = sanitizeToolCallRequestEnvelope(requestSanitized.envelope);
    if (!toolCallParamsSanitized.ok) {
      return {
        kind: "result",
        result: this.withPrependedAuditEvents(
          requestSanitizeAuditEvents,
          this.denyEnvelope(
            requestSanitized.envelope,
            denyDecision(toolCallParamsSanitized.reason, { code: "jsonrpc.invalid", method: "tools/call" }),
            "MCP tool call denied by proxy protocol state",
            "error"
          )
        )
      };
    }

    return {
      kind: "request",
      line: JSON.stringify(toolCallParamsSanitized.envelope),
      envelope: toolCallParamsSanitized.envelope,
      auditEvents: requestSanitizeAuditEvents
    };
  }

  private handlePreparedClientRequest(line: string, envelope: JsonRpcRequestEnvelope, preparedAuditEvents: readonly AuditEvent[] = []): ProxyFrameResult {
    const toolName = readToolCallName(envelope);
    const visibleTool = this.visibleTools.get(toolName);
    if (!visibleTool) {
      return this.withPrependedAuditEvents(
        preparedAuditEvents,
        this.denyEnvelope(
          envelope,
          denyDecision("tool was not visible in filtered discovery", { code: "tool.not_visible" }),
          "MCP tool call denied by policy",
          "call-decision",
          toolName || undefined
        )
      );
    }

    const normalized = normalizeToolCallEnvelope(envelope, visibleTool);
    const decision = evaluateToolCall({
      policy: this.options.policy,
      profileId: this.options.profileId,
      call: normalized,
      ...(this.options.approvalHookAvailable !== undefined ? { approvalHookAvailable: this.options.approvalHookAvailable } : {})
    });

    if (decision.action === "allow") {
      const pendingDenied = this.denyPendingCapacityExceeded(envelope, this.pendingRequestMethods, "client");
      if (pendingDenied) {
        return this.withPrependedAuditEvents(preparedAuditEvents, pendingDenied);
      }
      this.rememberPendingRequest(envelope);
      return {
        forwardLine: line,
        auditEvents: [...preparedAuditEvents, this.createAudit("call-decision", decision, normalized.toolName)]
      };
    }

    if (decision.action === "approval_required") {
      return this.withPrependedAuditEvents(
        preparedAuditEvents,
        this.denyEnvelope(
          envelope,
          denyDecision("approval required but no approval hook is available in this runtime path", {
            code: "policy.approval_hook_missing",
            ...approvalEvidence(decision)
          }),
          "MCP tool call denied by policy",
          "call-decision",
          normalized.toolName
        )
      );
    }

    return this.withPrependedAuditEvents(
      preparedAuditEvents,
      this.denyEnvelope(envelope, decision, "MCP tool call denied by policy", "call-decision", normalized.toolName)
    );
  }

  private async handlePreparedClientRequestWithApproval(
    line: string,
    envelope: JsonRpcRequestEnvelope,
    approvalHook: ApprovalHook,
    preparedAuditEvents: readonly AuditEvent[] = []
  ): Promise<ProxyFrameResult> {
    const toolName = readToolCallName(envelope);
    const visibleTool = this.visibleTools.get(toolName);
    if (!visibleTool) {
      return this.withPrependedAuditEvents(
        preparedAuditEvents,
        this.denyEnvelope(
          envelope,
          denyDecision("tool was not visible in filtered discovery", { code: "tool.not_visible" }),
          "MCP tool call denied by policy",
          "call-decision",
          toolName || undefined
        )
      );
    }

    const normalized = normalizeToolCallEnvelope(envelope, visibleTool);
    const decision = evaluateToolCall({
      policy: this.options.policy,
      profileId: this.options.profileId,
      call: normalized,
      approvalHookAvailable: true
    });

    if (decision.action === "allow") {
      const pendingDenied = this.denyPendingCapacityExceeded(envelope, this.pendingRequestMethods, "client");
      if (pendingDenied) {
        return this.withPrependedAuditEvents(preparedAuditEvents, pendingDenied);
      }
      this.rememberPendingRequest(envelope);
      return {
        forwardLine: line,
        auditEvents: [...preparedAuditEvents, this.createAudit("call-decision", decision, normalized.toolName)]
      };
    }

    if (decision.action !== "approval_required") {
      return this.withPrependedAuditEvents(
        preparedAuditEvents,
        this.denyEnvelope(envelope, decision, "MCP tool call denied by policy", "call-decision", normalized.toolName)
      );
    }

    let approval: ApprovalResult;
    try {
      approval = await this.callApprovalHook(approvalHook, normalized, decision);
    } catch (error) {
      const reason = error instanceof ApprovalHookTimeout ? "approval hook timed out" : "approval hook failed closed";
      return this.withPrependedAuditEvents(
        preparedAuditEvents,
        this.denyEnvelope(
          envelope,
          denyDecision(reason, {
            code: "policy.approval_hook_failed",
            ...approvalEvidence(decision)
          }),
          "MCP tool call denied by policy",
          "call-decision",
          normalized.toolName
        )
      );
    }

    if (approval.approved) {
      const pendingDenied = this.denyPendingCapacityExceeded(envelope, this.pendingRequestMethods, "client");
      if (pendingDenied) {
        return this.withPrependedAuditEvents(preparedAuditEvents, pendingDenied);
      }
      this.rememberPendingRequest(envelope);
      const finalDecision: PolicyDecision = {
        schemaVersion: decision.schemaVersion,
        action: "allow",
        evidence: decision.evidence.map((evidence) => ({
          ...evidence,
          code: "policy.approval_granted",
          reason: "approval required call approved by approval hook"
        }))
      };
      return {
        forwardLine: line,
        auditEvents: [...preparedAuditEvents, this.createAudit("call-decision", finalDecision, normalized.toolName)]
      };
    }

    return this.withPrependedAuditEvents(
      preparedAuditEvents,
      this.denyEnvelope(
        envelope,
        denyDecision("approval required call rejected by approval hook", {
          code: "policy.approval_denied",
          ...approvalEvidence(decision)
        }),
        "MCP tool call denied by policy",
        "call-decision",
        normalized.toolName
      )
    );
  }

  private async callApprovalHook(approvalHook: ApprovalHook, call: NormalizedToolCall, decision: PolicyDecision): Promise<ApprovalResult> {
    const approval = approvalHook({ call, decision });
    return await withApprovalTimeout(approval, this.approvalTimeoutMs);
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

      const requestSanitized = sanitizeJsonRpcRequestEnvelope(envelope);
      const requestSanitizeAuditEvents = this.createRequestEnvelopeRedactionAuditEvents("upstream", requestSanitized.redaction);
      const pendingDenied = this.denyPendingCapacityExceeded(requestSanitized.envelope, this.pendingServerOriginMethods, "upstream");
      if (pendingDenied) {
        return this.withPrependedAuditEvents(requestSanitizeAuditEvents, pendingDenied);
      }
      this.rememberPendingServerOriginRequest(requestSanitized.envelope);
      return {
        forwardLine: requestSanitized.redaction.applied ? JSON.stringify(requestSanitized.envelope) : line,
        auditEvents: requestSanitizeAuditEvents
      };
    }

    const errorSanitized = sanitizeUpstreamError(envelope, this.options.policy.redaction);
    const envelopeSanitized = sanitizeJsonRpcResponseEnvelope(errorSanitized.envelope);
    const sanitized = {
      envelope: envelopeSanitized.envelope,
      redactionApplied: errorSanitized.redaction.applied || envelopeSanitized.redaction.applied
    };
    const sanitizeAuditEvents = [
      ...this.createUpstreamErrorRedactionAuditEvents(errorSanitized.redaction),
      ...this.createResponseEnvelopeRedactionAuditEvents("upstream", envelopeSanitized.redaction)
    ];
    const responseLine = sanitized.redactionApplied ? JSON.stringify(sanitized.envelope) : line;

    const pendingRequest = this.takePendingRequest(sanitized.envelope);
    if (!pendingRequest) {
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

    if (pendingRequest.method !== "tools/list") {
      return {
        forwardLine: responseLine,
        auditEvents: sanitizeAuditEvents
      };
    }

    if ("error" in sanitized.envelope) {
      if (!pendingRequest.continuesDiscovery) {
        this.visibleTools.clear();
      }
      return {
        forwardLine: responseLine,
        auditEvents: sanitizeAuditEvents
      };
    }

    const result = filterToolListResult(sanitized.envelope, this.options.policy, this.options.profileId);
    if (!pendingRequest.continuesDiscovery) {
      this.visibleTools.clear();
    }
    for (const tool of result.visibleTools) {
      this.visibleTools.set(tool.name, tool);
    }

    return {
      forwardLine: JSON.stringify(result.envelope),
      auditEvents: [...sanitizeAuditEvents, ...this.createDiscoveryAuditEvents(result.filteredCount, result.sanitizedMalformedResult)]
    };
  }

  private takePendingRequest(envelope: JsonRpcResponse): PendingRequestState | undefined {
    if (envelope.id === undefined) {
      return undefined;
    }
    const key = requestIdKey(envelope.id);
    const pending = this.pendingRequestMethods.get(key);
    this.pendingRequestMethods.delete(key);
    return pending;
  }

  private rememberPendingRequest(envelope: JsonRpcRequestEnvelope): void {
    if (!hasJsonRpcRequestId(envelope)) {
      return;
    }
    this.pendingRequestMethods.set(requestIdKey(envelope.id), {
      method: envelope.method,
      expiresAt: Number.POSITIVE_INFINITY,
      ...(envelope.method === "tools/list" && hasDiscoveryCursor(envelope) ? { continuesDiscovery: true } : {})
    });
  }

  private takePendingServerOriginMethod(envelope: JsonRpcResponse): string | undefined {
    this.evictExpiredPendingRequests(this.pendingServerOriginMethods);
    const key = requestIdKey(envelope.id);
    const method = this.pendingServerOriginMethods.get(key)?.method;
    this.pendingServerOriginMethods.delete(key);
    return method;
  }

  private rememberPendingServerOriginRequest(envelope: JsonRpcRequestEnvelope): void {
    if (!hasJsonRpcRequestId(envelope)) {
      return;
    }
    this.pendingServerOriginMethods.set(requestIdKey(envelope.id), this.createPendingRequestState(envelope.method));
  }

  private denyDuplicatePendingRequest(
    envelope: JsonRpcRequestEnvelope,
    pending: Map<string, PendingRequestState>,
    reason: string
  ): ProxyFrameResult | undefined {
    this.evictExpiredPendingRequests(pending);
    if (!hasJsonRpcRequestId(envelope) || !pending.has(requestIdKey(envelope.id))) {
      return undefined;
    }
    return this.denyEnvelope(
      envelope,
      denyDecision(reason, {
        code: "jsonrpc.invalid",
        method: envelope.method
      }),
      "MCP request denied by proxy protocol state",
      "error"
    );
  }

  private denyPendingCapacityExceeded(
    envelope: JsonRpcRequestEnvelope,
    pending: Map<string, PendingRequestState>,
    direction: "client" | "upstream"
  ): ProxyFrameResult | undefined {
    this.evictExpiredPendingRequests(pending);
    if (!hasJsonRpcRequestId(envelope) || pending.size < this.maxPendingRequests) {
      return undefined;
    }
    return this.denyEnvelope(
      envelope,
      denyDecision(`${direction} pending request limit exceeded`, {
        code: "jsonrpc.invalid",
        method: envelope.method
      }),
      "MCP request denied by proxy protocol state",
      "error"
    );
  }

  private denyConcurrentDiscoveryRequest(envelope: JsonRpcRequestEnvelope): ProxyFrameResult | undefined {
    if (envelope.method !== "tools/list") {
      return undefined;
    }
    this.evictExpiredPendingRequests(this.pendingRequestMethods);
    for (const pending of this.pendingRequestMethods.values()) {
      if (pending.method === "tools/list") {
        return this.denyEnvelope(
          envelope,
          denyDecision("tools/list discovery request already has a pending upstream response", {
            code: "jsonrpc.invalid",
            method: "tools/list"
          }),
          "MCP request denied by proxy protocol state",
          "error"
        );
      }
    }
    return undefined;
  }

  private createPendingRequestState(method: string): PendingRequestState {
    return {
      method,
      expiresAt: Date.now() + this.pendingRequestTtlMs
    };
  }

  private evictExpiredPendingRequests(pending: Map<string, PendingRequestState>): void {
    const now = Date.now();
    for (const [key, value] of pending.entries()) {
      if (value.expiresAt <= now) {
        pending.delete(key);
      }
    }
  }

  private denyInvalidMethodShape(envelope: JsonRpcRequestEnvelope): ProxyFrameResult | undefined {
    if (requestMethodIdsRequired.has(envelope.method) && !hasJsonRpcRequestId(envelope)) {
      return this.denyInvalidClientMessage(
        envelope,
        "MCP request method must include a JSON-RPC id",
        "MCP request denied by proxy protocol state"
      );
    }
    if (notificationMethods.has(envelope.method) && hasJsonRpcRequestId(envelope)) {
      return this.denyInvalidClientMessage(
        envelope,
        "MCP notification method must not include a JSON-RPC id",
        "MCP notification denied by proxy protocol state"
      );
    }
    return undefined;
  }

  private denyInvalidServerOriginMethodShape(envelope: JsonRpcRequestEnvelope): ProxyFrameResult | undefined {
    if (envelope.method === "ping" && !hasJsonRpcRequestId(envelope)) {
      return this.denyEnvelope(
        envelope,
        denyDecision("server-origin ping must include a JSON-RPC id", { code: "jsonrpc.invalid", method: envelope.method }),
        "MCP method denied by policy",
        "method-denied"
      );
    }
    return undefined;
  }

  private denyInvalidClientMessage(envelope: JsonRpcRequestEnvelope, reason: string, message: string): ProxyFrameResult {
    const decision = denyDecision(reason, {
      code: "jsonrpc.invalid",
      method: envelope.method
    });
    return {
      responseLine: encodeJsonRpcError(hasJsonRpcRequestId(envelope) ? envelope.id : null, invalidRequestErrorCode, message, decision),
      auditEvents: [this.createAudit("error", decision, undefined, envelope.method)]
    };
  }

  private denyEnvelope(
    envelope: JsonRpcRequestEnvelope,
    decision: PolicyDecision,
    message: string,
    kind: "method-denied" | "call-decision" | "error",
    toolName?: string
  ): ProxyFrameResult {
    const auditEvent = this.createAudit(kind, decision, toolName, envelope.method);
    if (!hasJsonRpcRequestId(envelope)) {
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

  private createUpstreamErrorRedactionAuditEvents(redaction: RedactionSummary): readonly AuditEvent[] {
    if (!redaction.applied) {
      return [];
    }
    return [
      this.createAudit(
        "error",
        denyDecision(upstreamErrorRedactionReason(redaction), { code: upstreamErrorRedactionCode(redaction) }),
        undefined,
        undefined,
        redaction
      )
    ];
  }

  private createResponseEnvelopeRedactionAuditEvents(direction: "client" | "upstream", redaction: RedactionSummary): readonly AuditEvent[] {
    if (!redaction.applied) {
      return [];
    }
    return [
      this.createAudit(
        "error",
        denyDecision(`${direction} JSON-RPC response extra fields removed before forwarding`, {
          code: "jsonrpc.response_extra_fields_redacted"
        }),
        undefined,
        undefined,
        redaction
      )
    ];
  }

  private createRequestEnvelopeRedactionAuditEvents(direction: "client" | "upstream", redaction: RedactionSummary): readonly AuditEvent[] {
    if (!redaction.applied) {
      return [];
    }
    return [
      this.createAudit(
        "error",
        denyDecision(`${direction} JSON-RPC request extra fields removed before forwarding`, {
          code: "jsonrpc.request_extra_fields_redacted"
        }),
        undefined,
        undefined,
        redaction
      )
    ];
  }

  private withPrependedAuditEvents(auditEvents: readonly AuditEvent[], result: ProxyFrameResult): ProxyFrameResult {
    if (auditEvents.length === 0) {
      return result;
    }
    return {
      ...result,
      auditEvents: [...auditEvents, ...result.auditEvents]
    };
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
      return { ok: false, reason: "JSON-RPC id must be a string, safe integer number, null, or absent", code: "jsonrpc.invalid" };
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
    return { ok: true, value: buildJsonRpcEnvelope(parsed) };
  } catch {
    return { ok: false, reason: "message is not valid JSON", code: "jsonrpc.invalid" };
  }
}

function buildJsonRpcEnvelope(parsed: Readonly<Record<string, unknown>>): JsonRpcEnvelope {
  if (typeof parsed["method"] === "string") {
    const extraFields = copyExtraFields(parsed, jsonRpcRequestEnvelopeKeys);
    if ("id" in parsed) {
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id: readJsonRpcId(parsed["id"]),
        method: parsed["method"]
      };
      return withExtraFields("params" in parsed ? { ...request, params: parsed["params"] } : request, extraFields);
    }
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method: parsed["method"]
    };
    return withExtraFields("params" in parsed ? { ...notification, params: parsed["params"] } : notification, extraFields);
  }

  const extraFields = copyExtraFields(parsed, jsonRpcResponseEnvelopeKeys);
  if ("result" in parsed) {
    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: readJsonRpcId(parsed["id"]),
      result: parsed["result"]
    };
    return withExtraFields(response, extraFields);
  }

  const response: JsonRpcResponse = {
    jsonrpc: "2.0",
    id: readJsonRpcId(parsed["id"]),
    error: readJsonRpcErrorObject(parsed["error"])
  };
  return withExtraFields(response, extraFields);
}

function copyExtraFields(value: Readonly<Record<string, unknown>>, allowedKeys: ReadonlySet<string>): Readonly<Record<string, unknown>> {
  const extra: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!allowedKeys.has(key)) {
      extra[key] = entry;
    }
  }
  return extra;
}

function withExtraFields<T extends JsonRpcEnvelope>(envelope: T, extraFields: Readonly<Record<string, unknown>>): T {
  return Object.assign({}, extraFields, envelope);
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
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value));
}

function readJsonRpcId(value: unknown): JsonRpcId {
  return isJsonRpcId(value) ? value : null;
}

function hasJsonRpcRequestId(envelope: JsonRpcRequestEnvelope): envelope is JsonRpcRequest {
  return "id" in envelope && isJsonRpcId(envelope.id);
}

function isJsonRpcErrorObject(value: unknown): value is { readonly code: number; readonly message: string; readonly data?: unknown } {
  return isRecord(value) && typeof value["code"] === "number" && typeof value["message"] === "string";
}

function readJsonRpcErrorObject(value: unknown): JsonRpcErrorObject {
  if (!isJsonRpcErrorObject(value)) {
    return { code: invalidRequestErrorCode, message: "invalid JSON-RPC error object" };
  }
  return {
    ...value,
    code: value["code"],
    message: value["message"],
    ...("data" in value ? { data: value["data"] } : {})
  };
}

function sanitizeUpstreamError(
  envelope: JsonRpcResponse,
  redactionPolicy: PolicyDocument["redaction"]
): { readonly envelope: JsonRpcResponse; readonly redaction: RedactionSummary } {
  if (!isJsonRpcErrorResponse(envelope)) {
    return { envelope, redaction: noRedaction() };
  }
  const originalError = envelope.error;

  const error: Record<string, unknown> = {
    code: originalError.code,
    message: originalError.message
  };
  const counts: Record<string, number> = {};
  if ("data" in originalError) {
    counts["jsonrpc_error_data"] = 1;
  }

  const extraFieldCount = Object.keys(originalError).filter((key) => key !== "code" && key !== "message" && key !== "data").length;
  if (extraFieldCount > 0) {
    counts["jsonrpc_error_extra_fields"] = extraFieldCount;
  }

  if (typeof error["message"] === "string") {
    const redacted = redactText(error["message"], redactionPolicy);
    if (redacted.summary.applied) {
      error["message"] = redactedUpstreamErrorMessage;
      counts["jsonrpc_error_message"] = 1;
    }
  }

  if (Object.keys(counts).length === 0) {
    return { envelope, redaction: noRedaction() };
  }

  return {
    envelope: {
      ...envelope,
      error: {
        code: typeof error["code"] === "number" ? error["code"] : invalidRequestErrorCode,
        message: typeof error["message"] === "string" ? error["message"] : "upstream error redacted"
      }
    },
    redaction: {
      applied: true,
      counts
    }
  };
}

function sanitizeJsonRpcRequestEnvelope(
  envelope: JsonRpcRequestEnvelope
): { readonly envelope: JsonRpcRequestEnvelope; readonly redaction: RedactionSummary } {
  const extraFieldCount = Object.keys(envelope).filter((key) => !jsonRpcRequestEnvelopeKeys.has(key)).length;
  if (extraFieldCount === 0) {
    return { envelope, redaction: noRedaction() };
  }

  const sanitized = {
    jsonrpc: "2.0",
    method: envelope.method
  } as const;
  if (hasJsonRpcRequestId(envelope)) {
    const request: JsonRpcRequest = {
      ...sanitized,
      id: envelope.id,
      ...("params" in envelope ? { params: envelope.params } : {})
    };
    return {
      envelope: request,
      redaction: {
        applied: true,
        counts: {
          jsonrpc_request_extra_fields: extraFieldCount
        }
      }
    };
  }
  return {
    envelope: {
      ...sanitized,
      ...("params" in envelope ? { params: envelope.params } : {})
    },
    redaction: {
      applied: true,
      counts: {
        jsonrpc_request_extra_fields: extraFieldCount
      }
    }
  };
}

function sanitizeToolCallRequestEnvelope(
  envelope: JsonRpcRequestEnvelope
): { readonly ok: true; readonly envelope: JsonRpcRequestEnvelope } | { readonly ok: false; readonly reason: string } {
  const params = isRecord(envelope.params) ? envelope.params : undefined;
  if (!params) {
    return { ok: false, reason: "tools/call params must be an object" };
  }

  const extraParamCount = Object.keys(params).filter((key) => !toolCallParamKeys.has(key)).length;
  if (extraParamCount > 0) {
    return { ok: false, reason: "tools/call params must include only name and arguments" };
  }

  if (typeof params["name"] !== "string" || params["name"].trim().length === 0) {
    return { ok: false, reason: "tools/call params.name must be a non-empty string" };
  }

  const sanitizedParams: Record<string, unknown> = {
    name: params["name"]
  };
  if ("arguments" in params) {
    sanitizedParams["arguments"] = params["arguments"];
  }

  if ("id" in envelope) {
    return {
      ok: true,
      envelope: {
        jsonrpc: "2.0",
        id: envelope.id,
        method: "tools/call",
        params: sanitizedParams
      }
    };
  }
  return {
    ok: true,
    envelope: {
      jsonrpc: "2.0",
      method: "tools/call",
      params: sanitizedParams
    }
  };
}

function sanitizeJsonRpcResponseEnvelope(envelope: JsonRpcResponse): { readonly envelope: JsonRpcResponse; readonly redaction: RedactionSummary } {
  const extraFieldCount = Object.keys(envelope).filter((key) => !jsonRpcResponseEnvelopeKeys.has(key)).length;
  if (extraFieldCount === 0) {
    return { envelope, redaction: noRedaction() };
  }

  return {
    envelope:
      "result" in envelope
        ? {
            jsonrpc: "2.0",
            id: envelope.id,
            result: envelope.result
          }
        : {
            jsonrpc: "2.0",
            id: envelope.id,
            error: envelope.error
          },
    redaction: {
      applied: true,
      counts: {
        jsonrpc_response_extra_fields: extraFieldCount
      }
    }
  };
}

function upstreamErrorRedactionReason(redaction: RedactionSummary): string {
  const removedData = redaction.counts["jsonrpc_error_data"] !== undefined;
  const removedExtraFields = redaction.counts["jsonrpc_error_extra_fields"] !== undefined;
  const redactedMessage = redaction.counts["jsonrpc_error_message"] !== undefined;
  if (removedData && removedExtraFields && redactedMessage) {
    return "upstream JSON-RPC error data and extra fields removed and message redacted before forwarding";
  }
  if (removedData && redactedMessage) {
    return "upstream JSON-RPC error data removed and message redacted before forwarding";
  }
  if (removedExtraFields && redactedMessage) {
    return "upstream JSON-RPC error extra fields removed and message redacted before forwarding";
  }
  if (redactedMessage) {
    return "upstream JSON-RPC error message redacted before forwarding";
  }
  if (removedData && removedExtraFields) {
    return "upstream JSON-RPC error data and extra fields removed before forwarding";
  }
  if (removedExtraFields) {
    return "upstream JSON-RPC error extra fields removed before forwarding";
  }
  return "upstream JSON-RPC error data removed before forwarding";
}

function upstreamErrorRedactionCode(redaction: RedactionSummary): DecisionReasonCode {
  const removedData = redaction.counts["jsonrpc_error_data"] !== undefined;
  const removedExtraFields = redaction.counts["jsonrpc_error_extra_fields"] !== undefined;
  const redactedMessage = redaction.counts["jsonrpc_error_message"] !== undefined;
  if ((removedData || removedExtraFields) && redactedMessage) {
    return "jsonrpc.upstream_error_redacted";
  }
  if (removedExtraFields) {
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

function hasDiscoveryCursor(envelope: JsonRpcRequestEnvelope): boolean {
  return isRecord(envelope.params) && typeof envelope.params["cursor"] === "string";
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
  const duplicateToolNames = findDuplicateToolNames(tools);
  for (const item of tools) {
    if (!isRecord(item) || typeof item["name"] !== "string") {
      continue;
    }
    if (duplicateToolNames.has(item["name"])) {
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

function findDuplicateToolNames(tools: readonly unknown[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of tools) {
    if (!isRecord(item) || typeof item["name"] !== "string") {
      continue;
    }
    if (seen.has(item["name"])) {
      duplicates.add(item["name"]);
      continue;
    }
    seen.add(item["name"]);
  }
  return duplicates;
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

  return toolHasNonDenyPolicyCoverage(profile.rules, tool.name, tool.capabilities);
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

function denyDecision(
  reason: string,
  evidence: Omit<DecisionEvidence, "reason"> & { readonly code: NonNullable<DecisionEvidence["code"]> }
): PolicyDecision {
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

async function withApprovalTimeout(approval: ApprovalResult | Promise<ApprovalResult>, timeoutMs: number): Promise<ApprovalResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const approvalPromise = Promise.resolve(approval);
  approvalPromise.catch(() => undefined);
  try {
    return await Promise.race([
      approvalPromise,
      new Promise<ApprovalResult>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ApprovalHookTimeout()), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

class ApprovalHookTimeout extends Error {}

function noRedaction(): RedactionSummary {
  return {
    applied: false,
    counts: {}
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
