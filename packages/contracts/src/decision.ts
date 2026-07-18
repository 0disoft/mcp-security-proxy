import type { Capability, PolicyAction } from "./policy.js";

export const DECISION_SCHEMA_VERSION = "msp.decision.v1" as const;

export const DECISION_REASON_CODES = [
  "jsonrpc.invalid",
  "jsonrpc.frame_too_large",
  "jsonrpc.too_deep",
  "jsonrpc.unmatched_response",
  "jsonrpc.request_extra_fields_redacted",
  "jsonrpc.response_extra_fields_redacted",
  "jsonrpc.upstream_error_data_redacted",
  "jsonrpc.upstream_error_message_redacted",
  "jsonrpc.upstream_error_redacted",
  "method.supported",
  "method.unsupported",
  "method.server_origin_disallowed",
  "method.server_origin_ping_params",
  "tool.not_visible",
  "discovery.filtered",
  "policy.profile_not_found",
  "policy.default_deny",
  "policy.rule_allow",
  "policy.rule_deny",
  "policy.rule_approval_required",
  "policy.ambiguous_path",
  "policy.free_form_shell",
  "policy.ambiguous_network",
  "policy.secret_capability_required",
  "policy.unknown_capability",
  "policy.approval_denied",
  "policy.approval_granted",
  "policy.approval_hook_failed",
  "policy.approval_hook_missing",
  "policy.reloaded",
  "runtime.upstream_exit",
  "runtime.upstream_stderr"
] as const;

export type DecisionSchemaVersion = typeof DECISION_SCHEMA_VERSION;
export type DecisionAction = PolicyAction;
export type DecisionReasonCode = (typeof DECISION_REASON_CODES)[number];

export interface DecisionEvidence {
  readonly code: DecisionReasonCode;
  readonly ruleId?: string;
  readonly capability?: Capability;
  readonly method?: string;
  readonly reason: string;
}

export interface PolicyDecision {
  readonly schemaVersion: DecisionSchemaVersion;
  readonly action: DecisionAction;
  readonly evidence: readonly DecisionEvidence[];
}

export interface NormalizedMcpMethod {
  readonly method: string;
  readonly supported: boolean;
}

export interface NormalizedToolDescriptor {
  readonly name: string;
  readonly description?: string;
  readonly capabilities: readonly Capability[];
}

export interface NormalizedToolCall {
  readonly toolName: string;
  readonly method: "tools/call";
  readonly capabilities: readonly Capability[];
  readonly argumentFacts: readonly ArgumentFact[];
}

export type ArgumentFact =
  | { readonly kind: "path"; readonly value: string }
  | { readonly kind: "command"; readonly executable: string; readonly argv: readonly string[] }
  | { readonly kind: "network"; readonly value: string }
  | { readonly kind: "secret"; readonly label: string };
