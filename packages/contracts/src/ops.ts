export const OPS_EVENT_SCHEMA_VERSION = "msp.ops-event.v1" as const;
export const OPS_EVENT_KINDS = ["lifecycle"] as const;
export const OPS_LIFECYCLE_EVENTS = ["proxy.start", "proxy.stop"] as const;

export type OpsEventSchemaVersion = typeof OPS_EVENT_SCHEMA_VERSION;
export type OpsEventKind = (typeof OPS_EVENT_KINDS)[number];
export type OpsLifecycleEvent = (typeof OPS_LIFECYCLE_EVENTS)[number];

export interface StdioProxyMetrics {
  readonly clientFrames: number;
  readonly upstreamFrames: number;
  readonly clientFramesForwarded: number;
  readonly upstreamFramesForwarded: number;
  readonly clientDenials: number;
  readonly upstreamDenials: number;
  readonly protocolResponsesWritten: number;
  readonly auditEventsWritten: number;
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
    };
