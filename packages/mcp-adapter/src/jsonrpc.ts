export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  readonly [key: string]: unknown;
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly [key: string]: unknown;
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcErrorObject {
  readonly [key: string]: unknown;
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export type JsonRpcResponse =
  | {
      readonly [key: string]: unknown;
      readonly jsonrpc: "2.0";
      readonly id: JsonRpcId;
      readonly result: unknown;
    }
  | {
      readonly [key: string]: unknown;
      readonly jsonrpc: "2.0";
      readonly id: JsonRpcId;
      readonly error: JsonRpcErrorObject;
    };

export type JsonRpcEnvelope = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest | JsonRpcNotification {
  if (!isRecord(value)) {
    return false;
  }

  return value["jsonrpc"] === "2.0" && typeof value["method"] === "string";
}

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return (
    isRecord(value) &&
    value["jsonrpc"] === "2.0" &&
    !("method" in value) &&
    "id" in value &&
    ("result" in value || "error" in value)
  );
}

export function isJsonRpcErrorResponse(
  value: JsonRpcEnvelope
): value is Extract<JsonRpcResponse, { readonly error: JsonRpcErrorObject }> {
  return "error" in value;
}

export function getRequestMethod(value: unknown): string | undefined {
  return isJsonRpcRequest(value) ? value.method : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
