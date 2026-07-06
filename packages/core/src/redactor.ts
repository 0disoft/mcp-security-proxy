import type { RedactionSummary } from "@0disoft/mcp-security-proxy-contracts";

export interface RedactionResult {
  readonly value: string;
  readonly summary: RedactionSummary;
}

const secretLikePattern = /\b(?:TOKEN|PRIVATE|CREDENTIAL)[A-Z0-9_]*\b/g;

export function redactText(value: string, replacement = "[REDACTED]"): RedactionResult {
  let count = 0;
  const redacted = value.replace(secretLikePattern, () => {
    count += 1;
    return replacement;
  });

  return {
    value: redacted,
    summary: {
      applied: count > 0,
      counts: count > 0 ? { secret_like: count } : {}
    }
  };
}
