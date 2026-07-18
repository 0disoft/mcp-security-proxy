export const OPS_EVENT_SCHEMA_VERSION = "msp.ops-event.v1" as const;
export const OPS_EVENT_KINDS = ["lifecycle", "policy"] as const;
export const OPS_LIFECYCLE_EVENTS = ["proxy.start", "proxy.stop"] as const;
export const OPS_POLICY_EVENTS = ["policy.reload_applied", "policy.reload_rejected"] as const;
export const POLICY_RELOAD_REJECTION_CODES = [
  "read_failed",
  "invalid_policy",
  "profile_missing",
  "audit_changed",
  "watch_failed",
  "runtime_validation_failed"
] as const;

export type OpsEventSchemaVersion = typeof OPS_EVENT_SCHEMA_VERSION;
export type OpsEventKind = (typeof OPS_EVENT_KINDS)[number];
export type OpsLifecycleEvent = (typeof OPS_LIFECYCLE_EVENTS)[number];
export type OpsPolicyEvent = (typeof OPS_POLICY_EVENTS)[number];
export type PolicyReloadRejectionCode = (typeof POLICY_RELOAD_REJECTION_CODES)[number];

export interface StdioProxyMetrics {
  readonly clientFrames: number;
  readonly upstreamFrames: number;
  readonly clientFramesForwarded: number;
  readonly upstreamFramesForwarded: number;
  readonly clientDenials: number;
  readonly upstreamDenials: number;
  readonly protocolResponsesWritten: number;
  readonly auditEventsWritten: number;
  readonly auditWriteFailures: number;
  readonly policyReloadsApplied: number;
  readonly policyReloadsRejected: number;
}

export type StdioProxyOpsEvent =
  | {
      readonly schemaVersion: OpsEventSchemaVersion;
      readonly timestamp: string;
      readonly kind: "lifecycle";
      readonly event: "proxy.start";
      readonly profileId: string;
      readonly maxFrameBytes: number;
      readonly maxJsonDepth?: number;
      readonly metrics: StdioProxyMetrics;
    }
  | {
      readonly schemaVersion: OpsEventSchemaVersion;
      readonly timestamp: string;
      readonly kind: "lifecycle";
      readonly event: "proxy.stop";
      readonly profileId: string;
      readonly exitCode: number;
      readonly elapsedMs: number;
      readonly metrics: StdioProxyMetrics;
    }
  | {
      readonly schemaVersion: OpsEventSchemaVersion;
      readonly timestamp: string;
      readonly kind: "policy";
      readonly event: "policy.reload_applied";
      readonly profileId: string;
      readonly revision: number;
      readonly metrics: StdioProxyMetrics;
    }
  | {
      readonly schemaVersion: OpsEventSchemaVersion;
      readonly timestamp: string;
      readonly kind: "policy";
      readonly event: "policy.reload_rejected";
      readonly profileId: string;
      readonly reasonCode: PolicyReloadRejectionCode;
      readonly metrics: StdioProxyMetrics;
    };
