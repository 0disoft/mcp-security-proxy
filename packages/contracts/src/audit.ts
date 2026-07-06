import type { PolicyDecision } from "./decision.js";

export const AUDIT_EVENT_SCHEMA_VERSION = "msp.audit-event.v1" as const;

export type AuditEventSchemaVersion = typeof AUDIT_EVENT_SCHEMA_VERSION;
export type AuditEventKind = "method-denied" | "discovery-filtered" | "call-decision" | "error";

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
}
