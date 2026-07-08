import type {
  Capability,
  NormalizedToolCall
} from "@0disoft/mcp-security-proxy-contracts";
import type { JsonRpcNotification, JsonRpcRequest } from "./jsonrpc.js";

export interface ToolCallMetadata {
  readonly name: string;
  readonly capabilities: readonly Capability[];
}

export function normalizeToolCallEnvelope(envelope: JsonRpcRequest | JsonRpcNotification, visibleTool: ToolCallMetadata): NormalizedToolCall {
  const params = isRecord(envelope.params) ? envelope.params : {};
  return {
    method: "tools/call",
    toolName: visibleTool.name,
    capabilities: visibleTool.capabilities,
    argumentFacts: extractArgumentFacts(params["arguments"])
  };
}

export function extractArgumentFacts(value: unknown): NormalizedToolCall["argumentFacts"] {
  const facts: NormalizedToolCall["argumentFacts"][number][] = [];
  collectArgumentFacts(value, facts);
  return facts;
}

function collectArgumentFacts(value: unknown, facts: NormalizedToolCall["argumentFacts"][number][]): void {
  if (typeof value === "string") {
    const fileUrlPath = pathFromFileUrl(value);
    if (fileUrlPath) {
      facts.push({ kind: "path", value: fileUrlPath });
      return;
    }
    if (looksLikeUrl(value)) {
      facts.push({ kind: "network", value });
      return;
    }
    if (looksLikePath(value)) {
      facts.push({ kind: "path", value });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectArgumentFacts(item, facts);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const executable = value["executable"];
  const argv = value["argv"];
  if (typeof executable === "string" && Array.isArray(argv) && argv.every((item) => typeof item === "string")) {
    facts.push({ kind: "command", executable, argv });
  }

  for (const [key, entry] of Object.entries(value)) {
    const secretLabel = secretLabelForKey(key);
    if (secretLabel) {
      facts.push({ kind: "secret", label: secretLabel });
    }
    collectArgumentFacts(entry, facts);
  }
}

function secretLabelForKey(key: string): string | undefined {
  const normalized = key.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase().replace(/[_-]+/gu, " ");
  if (/\bapi\s*key\b|\bapikey\b/u.test(normalized)) {
    return "api-key";
  }
  if (/\btoken\b/u.test(normalized)) {
    return "token";
  }
  if (/\bpassword\b/u.test(normalized)) {
    return "password";
  }
  if (/\bcredentials?\b/u.test(normalized)) {
    return "credential";
  }
  if (/\bsecret\b/u.test(normalized)) {
    return "secret";
  }
  return undefined;
}

function looksLikePath(value: string): boolean {
  return (
    value.includes("/") ||
    value.includes("\\") ||
    /^\.{1,2}(?:$|[/\\])/u.test(value) ||
    /^\.[A-Za-z0-9_-]+$/u.test(value) ||
    /\.(?:bat|cert|cmd|conf|config|crt|csv|db|env|go|ini|java|js|json|jsx|key|log|md|pem|ps1|py|rb|rs|sh|sqlite|sql|toml|ts|tsx|txt|ya?ml)$/iu.test(
      value
    )
  );
}

function looksLikeUrl(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value);
}

function pathFromFileUrl(value: string): string | undefined {
  if (!/^file:\/\//iu.test(value)) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "file:" && parsed.pathname.length > 0 ? parsed.pathname : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
