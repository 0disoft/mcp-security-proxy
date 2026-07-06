import type { Capability, PolicyAction } from "./policy.js";

export const DECISION_SCHEMA_VERSION = "msp.decision.v1" as const;

export type DecisionSchemaVersion = typeof DECISION_SCHEMA_VERSION;
export type DecisionAction = PolicyAction;

export interface DecisionEvidence {
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

