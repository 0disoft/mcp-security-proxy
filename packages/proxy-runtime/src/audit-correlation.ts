import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { AUDIT_CORRELATION_VERSION, type AuditCorrelation } from "@0disoft/mcp-security-proxy-contracts";
import type { JsonRpcId } from "@0disoft/mcp-security-proxy-mcp-adapter";

export type AuditDirection = AuditCorrelation["direction"];
export type JsonRpcIdType = AuditCorrelation["jsonRpcIdType"];

interface FrameCorrelation {
  direction: AuditDirection;
  transportEventId: string;
  jsonRpcIdHash?: string;
  jsonRpcIdType: JsonRpcIdType;
  method?: string;
  matchedRequestMethod?: string;
  pendingAgeMs?: number;
  durationMs?: number;
}

export interface PendingAuditCorrelation {
  readonly transportEventId: string;
  readonly jsonRpcIdHash?: string;
  readonly jsonRpcIdType: JsonRpcIdType;
  readonly method: string;
  readonly receivedAt: number;
}

const maximumDurationMs = 2_147_483_647;

export class AuditCorrelator {
  private readonly frames = new AsyncLocalStorage<FrameCorrelation>();
  private readonly sessionId = randomUUID();
  private readonly idHashKey = randomBytes(32);
  private sequence = 0;
  private transportEventSequence = 0;
  private discoveryGeneration = 0;

  runFrame<T>(direction: AuditDirection, callback: () => T): T {
    return this.frames.run(
      {
        direction,
        transportEventId: this.nextTransportEventId(),
        jsonRpcIdType: "absent"
      },
      callback
    );
  }

  attachEnvelope(envelope: { readonly id?: JsonRpcId; readonly method?: string }): void {
    const frame = this.frames.getStore();
    if (!frame) {
      return;
    }
    const idType = jsonRpcIdType(envelope);
    frame.jsonRpcIdType = idType;
    if (idType !== "absent") {
      frame.jsonRpcIdHash = this.hashJsonRpcId(envelope.id);
    }
    if (typeof envelope.method === "string" && envelope.method.length > 0) {
      frame.method = envelope.method;
    }
  }

  setDirection(direction: AuditDirection): void {
    const frame = this.frames.getStore();
    if (frame) {
      frame.direction = direction;
    }
  }

  snapshotPending(method: string): PendingAuditCorrelation {
    const frame = this.frames.getStore();
    return {
      transportEventId: frame?.transportEventId ?? this.nextTransportEventId(),
      ...(frame?.jsonRpcIdHash ? { jsonRpcIdHash: frame.jsonRpcIdHash } : {}),
      jsonRpcIdType: frame?.jsonRpcIdType ?? "absent",
      method,
      receivedAt: Date.now()
    };
  }

  matchPending(pending: PendingAuditCorrelation, direction?: AuditDirection): void {
    const frame = this.frames.getStore();
    if (!frame) {
      return;
    }
    frame.transportEventId = pending.transportEventId;
    frame.jsonRpcIdType = pending.jsonRpcIdType;
    if (pending.jsonRpcIdHash) {
      frame.jsonRpcIdHash = pending.jsonRpcIdHash;
    }
    frame.matchedRequestMethod = pending.method;
    frame.pendingAgeMs = boundedElapsed(pending.receivedAt);
    if (direction) {
      frame.direction = direction;
    }
  }

  markDiscoveryAccepted(): void {
    this.discoveryGeneration += 1;
  }

  setDuration(startedAt: number): void {
    const frame = this.frames.getStore();
    if (frame) {
      frame.durationMs = boundedElapsed(startedAt);
    }
  }

  createCorrelation(method?: string): AuditCorrelation {
    const frame = this.frames.getStore();
    const correlatedMethod = method ?? frame?.method;
    return {
      correlationVersion: AUDIT_CORRELATION_VERSION,
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      direction: frame?.direction ?? "runtime",
      transport: "stdio",
      transportEventId: frame?.transportEventId ?? this.nextTransportEventId(),
      ...(frame?.jsonRpcIdHash ? { jsonRpcIdHash: frame.jsonRpcIdHash } : {}),
      jsonRpcIdType: frame?.jsonRpcIdType ?? "absent",
      ...(correlatedMethod ? { method: correlatedMethod } : {}),
      ...(frame?.matchedRequestMethod ? { matchedRequestMethod: frame.matchedRequestMethod } : {}),
      discoveryGeneration: this.discoveryGeneration,
      ...(frame?.pendingAgeMs !== undefined ? { pendingAgeMs: frame.pendingAgeMs } : {}),
      ...(frame?.durationMs !== undefined ? { durationMs: frame.durationMs } : {})
    };
  }

  private nextTransportEventId(): string {
    return `stdio-${++this.transportEventSequence}`;
  }

  private hashJsonRpcId(id: JsonRpcId | undefined): string {
    return createHmac("sha256", this.idHashKey).update(canonicalJsonRpcId(id)).digest("hex");
  }
}

function jsonRpcIdType(envelope: { readonly id?: JsonRpcId }): JsonRpcIdType {
  if (!("id" in envelope)) {
    return "absent";
  }
  if (envelope.id === null) {
    return "null";
  }
  return typeof envelope.id === "number" ? "number" : "string";
}

function canonicalJsonRpcId(id: JsonRpcId | undefined): string {
  if (id === null) {
    return "null:null";
  }
  return `${typeof id}:${String(id)}`;
}

function boundedElapsed(startedAt: number): number {
  return Math.min(maximumDurationMs, Math.max(0, Date.now() - startedAt));
}
