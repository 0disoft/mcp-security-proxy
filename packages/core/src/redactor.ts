import type { RedactionSummary } from "@0disoft/mcp-security-proxy-contracts";

export interface RedactionResult {
  readonly value: string;
  readonly summary: RedactionSummary;
}

const redactionMarkerPattern = /\bREDACT_ME[A-Z0-9_]*\b/g;
const secretLikePatterns = [
  redactionMarkerPattern,
  /\bsk-[A-Za-z0-9]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{10,}\b/gi,
  /\b(?:TOKEN|PRIVATE|CREDENTIAL)[A-Z0-9_]*\s*[:=]\s*\S+/g,
  /\b(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S+/gi,
  /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/g
] as const;
const pathLikePatterns = [
  /(?:^|\s)[A-Za-z]:[\\/]\S+/g,
  /(?:^|\s)(?:\.{1,2}|~|workspace|home|users?|tmp|temp|private|secrets?)[\\/]\S+/gi,
  /(?:^|\s)\S+[\\/]\S*\.[A-Za-z0-9]{1,12}(?=\s|$)/g
] as const;

export function redactText(value: string, replacement = "[REDACTED]"): RedactionResult {
  const counts: Record<string, number> = {};
  let redacted = value;
  for (const pattern of secretLikePatterns) {
    redacted = replaceAndCount(redacted, pattern, replacement, counts, "secret_like");
  }
  for (const pattern of pathLikePatterns) {
    redacted = replaceAndCount(redacted, pattern, replacement, counts, "path");
  }

  return {
    value: redacted,
    summary: {
      applied: Object.keys(counts).length > 0,
      counts
    }
  };
}

function replaceAndCount(
  value: string,
  pattern: RegExp,
  replacement: string,
  counts: Record<string, number>,
  label: "path" | "secret_like"
): string {
  return value.replace(pattern, () => {
    counts[label] = (counts[label] ?? 0) + 1;
    return replacement;
  });
}
