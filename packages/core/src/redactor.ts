import type {
  RedactionPolicy,
  RedactionSummary
} from "@0disoft/mcp-security-proxy-contracts";

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
const environmentValuePatterns = [
  /\b[A-Z_][A-Z0-9_]{1,}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s;]+)/g
] as const;
const promptLikePatterns = [
  /\bprompt\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\r\n;]+)/gi
] as const;

type RedactionKind = RedactionPolicy["detectors"][number]["kind"];

const builtInPatternFamilies: Readonly<Record<RedactionKind, readonly RegExp[]>> = {
  secret_like: secretLikePatterns,
  environment_value: environmentValuePatterns,
  path: pathLikePatterns,
  prompt: promptLikePatterns
};

export function redactText(value: string, options: RedactionPolicy | string = "[REDACTED]"): RedactionResult {
  const detectors = resolveDetectors(options);
  const counts: Record<string, number> = {};
  let redacted = value;
  for (const detector of detectors) {
    for (const pattern of builtInPatternFamilies[detector.kind]) {
      redacted = replaceAndCount(redacted, pattern, detector.replacement, counts, detector.kind);
    }
  }

  return {
    value: redacted,
    summary: {
      applied: Object.keys(counts).length > 0,
      counts
    }
  };
}

function resolveDetectors(options: RedactionPolicy | string): readonly { readonly kind: RedactionKind; readonly replacement: string }[] {
  if (typeof options === "string") {
    return [
      { kind: "secret_like", replacement: options },
      { kind: "path", replacement: options }
    ];
  }

  const configured = new Map<RedactionKind, string>();
  for (const detector of options.detectors) {
    if (!configured.has(detector.kind)) {
      configured.set(detector.kind, detector.replacement);
    }
  }

  const detectors: { readonly kind: RedactionKind; readonly replacement: string }[] = [
    { kind: "secret_like", replacement: configured.get("secret_like") ?? "[REDACTED]" },
    { kind: "path", replacement: configured.get("path") ?? "[REDACTED]" }
  ];
  for (const kind of ["environment_value", "prompt"] as const) {
    const replacement = configured.get(kind);
    if (replacement !== undefined) {
      detectors.push({ kind, replacement });
    }
  }
  return detectors;
}

function replaceAndCount(
  value: string,
  pattern: RegExp,
  replacement: string,
  counts: Record<string, number>,
  label: RedactionKind
): string {
  return value.replace(pattern, () => {
    counts[label] = (counts[label] ?? 0) + 1;
    return replacement;
  });
}
