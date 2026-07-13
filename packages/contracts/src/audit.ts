import type { PolicyDecision } from "./decision.js";

export const AUDIT_EVENT_SCHEMA_VERSION = "msp.audit-event.v1" as const;
export const AUDIT_EVENT_KINDS = ["method-denied", "discovery-filtered", "call-decision", "error"] as const;

export type AuditEventSchemaVersion = typeof AUDIT_EVENT_SCHEMA_VERSION;
export type AuditEventKind = (typeof AUDIT_EVENT_KINDS)[number];
export const AUDIT_CORRELATION_VERSION = "msp.audit-correlation.v2" as const;
export const AUDIT_DIRECTIONS = ["client_to_upstream", "upstream_to_client", "server_origin", "runtime"] as const;
export const JSON_RPC_ID_TYPES = ["string", "number", "null", "absent"] as const;

export interface AuditCorrelation {
  readonly correlationVersion: typeof AUDIT_CORRELATION_VERSION;
  readonly sessionId: string;
  readonly sequence: number;
  readonly direction: (typeof AUDIT_DIRECTIONS)[number];
  readonly transport: "stdio";
  readonly transportEventId: string;
  readonly jsonRpcIdHash?: string;
  readonly jsonRpcIdType: (typeof JSON_RPC_ID_TYPES)[number];
  readonly method?: string;
  readonly matchedRequestMethod?: string;
  readonly discoveryGeneration: number;
  readonly pendingAgeMs?: number;
  readonly durationMs?: number;
}

export interface RedactionSummary {
  readonly applied: boolean;
  readonly counts: Readonly<Record<string, number>>;
}

export interface AuditEvent {
  readonly schemaVersion: AuditEventSchemaVersion;
  readonly kind: AuditEventKind;
  readonly profileId: string;
  readonly toolName?: string;
  readonly method?: string;
  readonly decision: PolicyDecision;
  readonly redaction: RedactionSummary;
  readonly correlation?: AuditCorrelation;
}
