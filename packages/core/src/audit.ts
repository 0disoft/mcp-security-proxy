import {
  AUDIT_EVENT_SCHEMA_VERSION,
  type AuditEvent,
  type AuditEventKind,
  type PolicyDecision,
  type RedactionSummary
} from "@0disoft/mcp-security-proxy-contracts";

export interface CreateAuditEventOptions {
  readonly kind: AuditEventKind;
  readonly profileId: string;
  readonly decision: PolicyDecision;
  readonly redaction: RedactionSummary;
  readonly toolName?: string;
  readonly method?: string;
}

export function createAuditEvent(options: CreateAuditEventOptions): AuditEvent {
  return {
    schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
    kind: options.kind,
    profileId: options.profileId,
    ...(options.toolName ? { toolName: options.toolName } : {}),
    ...(options.method ? { method: options.method } : {}),
    decision: options.decision,
    redaction: options.redaction
  };
}

export function formatAuditEventJsonLine(event: AuditEvent): string {
  return `${JSON.stringify(event)}\n`;
}
