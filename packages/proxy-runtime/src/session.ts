import {
  type AuditEvent,
  type Capability,
  type DecisionEvidence,
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
}

export interface ProxyFrameResult {
  readonly forwardLine?: string;
  readonly responseLine?: string;
  readonly auditEvents: readonly AuditEvent[];
}

interface ToolMetadata {
  readonly name: string;
  readonly description?: string;
  readonly capabilities: readonly Capability[];
}

const policyDeniedErrorCode = -32001;
const invalidRequestErrorCode = -32600;
const upstreamServerOriginAllowedMethods = new Set(["ping"]);

export class ProxySession {
  private readonly pendingRequestMethods = new Map<string, string>();
  private readonly visibleTools = new Map<string, ToolMetadata>();

  constructor(private readonly options: ProxySessionOptions) {}

  handleClientLine(line: string): ProxyFrameResult {
    const parsed = parseJsonLine(line);
    if (!parsed.ok) {
      const decision = denyDecision(parsed.reason);
      return {
        responseLine: encodeJsonRpcError(null, invalidRequestErrorCode, "invalid MCP JSON-RPC message", decision),
        auditEvents: [this.createAudit("error", decision)]
      };
    }

    const envelope = parsed.value;
    if (!isJsonRpcRequest(envelope)) {
      return {
        forwardLine: line,
        auditEvents: []
      };
    }

    const methodDecision = evaluateEnvelopeMethod(envelope, this.options.policy);
    if (methodDecision.action !== "allow") {
      return this.denyEnvelope(envelope, methodDecision, "MCP method denied by policy", "method-denied");
    }

    if (envelope.id !== undefined) {
      this.pendingRequestMethods.set(requestIdKey(envelope.id), envelope.method);
    }

    if (envelope.method !== "tools/call") {
      return {
        forwardLine: line,
        auditEvents: []
      };
    }

    const toolName = readToolCallName(envelope);
    const visibleTool = this.visibleTools.get(toolName);
    if (!visibleTool) {
      return this.denyEnvelope(
        envelope,
        denyDecision("tool was not visible in filtered discovery"),
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
      return {
        forwardLine: line,
        auditEvents: [this.createAudit("call-decision", decision, normalized.toolName)]
      };
    }

    return this.denyEnvelope(envelope, decision, "MCP tool call denied by policy", "call-decision", normalized.toolName);
  }

  handleServerLine(line: string): ProxyFrameResult {
    const parsed = parseJsonLine(line);
    if (!parsed.ok) {
      const decision = denyDecision(parsed.reason);
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

      return {
        forwardLine: line,
        auditEvents: []
      };
    }

    const requestMethod = this.takePendingMethod(envelope);
    if (requestMethod !== "tools/list") {
      return {
        forwardLine: line,
        auditEvents: []
      };
    }

    const result = filterToolListResult(envelope, this.options.policy, this.options.profileId);
    this.visibleTools.clear();
    for (const tool of result.visibleTools) {
      this.visibleTools.set(tool.name, tool);
    }

    return {
      forwardLine: JSON.stringify(result.envelope),
      auditEvents:
        result.filteredCount > 0
          ? [this.createAudit("discovery-filtered", denyDecision(`${result.filteredCount} tool(s) hidden by discovery policy`))]
          : []
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

  private denyEnvelope(
    envelope: JsonRpcEnvelope,
    decision: PolicyDecision,
    message: string,
    kind: "method-denied" | "call-decision",
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

  private createAudit(kind: AuditEvent["kind"], decision: PolicyDecision, toolName?: string, method?: string): AuditEvent {
    return createAuditEvent({
      kind,
      profileId: this.options.profileId,
      decision,
      redaction: noRedaction(),
      ...(toolName ? { toolName } : {}),
      ...(method ? { method } : {})
    });
  }
}

export function createProxySession(options: ProxySessionOptions): ProxySession {
  return new ProxySession(options);
}

function parseJsonLine(line: string): { readonly ok: true; readonly value: JsonRpcEnvelope } | { readonly ok: false; readonly reason: string } {
  if (line.includes("\n") || line.includes("\r")) {
    return { ok: false, reason: "stdio MCP messages must be newline-delimited without embedded newlines" };
  }

  try {
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed) || parsed["jsonrpc"] !== "2.0") {
      return { ok: false, reason: "message is not a JSON-RPC 2.0 object" };
    }
    if ("id" in parsed && !isJsonRpcId(parsed["id"])) {
      return { ok: false, reason: "JSON-RPC id must be a string, number, null, or absent" };
    }
    if ("method" in parsed && typeof parsed["method"] !== "string") {
      return { ok: false, reason: "JSON-RPC method must be a string when present" };
    }
    const hasMethod = "method" in parsed;
    const hasResult = "result" in parsed;
    const hasError = "error" in parsed;
    if (hasMethod && (hasResult || hasError)) {
      return { ok: false, reason: "JSON-RPC request or notification must not include result or error" };
    }
    if (!hasMethod) {
      if (!("id" in parsed)) {
        return { ok: false, reason: "JSON-RPC response must include an id" };
      }
      if (hasResult === hasError) {
        return { ok: false, reason: "JSON-RPC response must include exactly one of result or error" };
      }
    }
    return { ok: true, value: parsed as unknown as JsonRpcEnvelope };
  } catch {
    return { ok: false, reason: "message is not valid JSON" };
  }
}

function isJsonRpcId(value: unknown): value is string | number | null {
  return value === null || typeof value === "string" || typeof value === "number";
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
): { readonly envelope: JsonRpcEnvelope; readonly visibleTools: readonly ToolMetadata[]; readonly filteredCount: number } {
  const result = isRecord(envelope.result) ? envelope.result : undefined;
  const tools = Array.isArray(result?.["tools"]) ? result["tools"] : undefined;
  if (!result || !tools) {
    return { envelope, visibleTools: [], filteredCount: 0 };
  }

  const visibleTools: ToolMetadata[] = [];
  const filteredTools: unknown[] = [];
  for (const item of tools) {
    if (!isRecord(item) || typeof item["name"] !== "string") {
      continue;
    }
    const description = typeof item["description"] === "string" ? item["description"] : undefined;
    const classified = classifyToolDescriptor({
      name: item["name"],
      ...(description ? { description } : {})
    }).descriptor;
    const metadata: ToolMetadata = {
      name: classified.name,
      ...(classified.description ? { description: classified.description } : {}),
      capabilities: classified.capabilities
    };

    if (toolIsDiscoverable(metadata, policy, profileId)) {
      visibleTools.push(metadata);
      filteredTools.push(item);
    }
  }

  return {
    envelope: {
      ...envelope,
      result: {
        ...result,
        tools: filteredTools
      }
    },
    visibleTools,
    filteredCount: tools.length - filteredTools.length
  };
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
    return denyDecision("MCP method is not allowed from upstream server", { method: envelope.method });
  }

  if (envelope.method === "ping" && !hasNoParamsOrEmptyObjectParams(envelope)) {
    return denyDecision("server-origin ping must not carry params", { method: envelope.method });
  }

  return policyDecision;
}

function hasNoParamsOrEmptyObjectParams(envelope: JsonRpcEnvelope): boolean {
  if (envelope.params === undefined) {
    return true;
  }
  return isRecord(envelope.params) && Object.keys(envelope.params).length === 0;
}

function denyDecision(reason: string, evidence?: Omit<DecisionEvidence, "reason">): PolicyDecision {
  return {
    schemaVersion: "msp.decision.v1",
    action: "deny",
    evidence: [{ ...evidence, reason }]
  };
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
