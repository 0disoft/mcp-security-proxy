export interface JsonRpcEnvelope {
  readonly jsonrpc: "2.0";
  readonly id?: string | number | null;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcEnvelope & { readonly method: string } {
  if (!isRecord(value)) {
    return false;
  }

  return value["jsonrpc"] === "2.0" && typeof value["method"] === "string";
}

export function getRequestMethod(value: unknown): string | undefined {
  return isJsonRpcRequest(value) ? value.method : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
