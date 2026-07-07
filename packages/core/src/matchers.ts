import type {
  ArgumentFact,
  CommandRule,
  NetworkRule,
  PathRule,
  SecretRule
} from "@0disoft/mcp-security-proxy-contracts";

export interface MatcherIssue {
  readonly kind: ArgumentFact["kind"];
  readonly reason: string;
}

export function findBlockingArgumentIssue(facts: readonly ArgumentFact[]): MatcherIssue | undefined {
  for (const fact of facts) {
    if (fact.kind === "path" && !normalizePathValue(fact.value).ok) {
      return { kind: "path", reason: "ambiguous path denied by default" };
    }

    if (fact.kind === "command" && isDeniedShellCommand(fact)) {
      return { kind: "command", reason: "free-form shell command denied by default" };
    }

    if (fact.kind === "network" && !normalizeNetworkValue(fact.value).ok) {
      return { kind: "network", reason: "ambiguous network target denied by default" };
    }
  }

  return undefined;
}

export function pathRuleMatches(rule: PathRule, facts: readonly ArgumentFact[], mode: "allow" | "deny"): boolean {
  const pathFacts = facts.filter((fact): fact is Extract<ArgumentFact, { readonly kind: "path" }> => fact.kind === "path");
  if (pathFacts.length === 0) {
    return false;
  }

  const allowedRoots = normalizeRoots(rule.allowedRoots);
  const deniedRoots = normalizeRoots(rule.deniedRoots);

  return pathFacts.some((fact) => {
    const normalized = normalizePathValue(fact.value);
    if (!normalized.ok) {
      return mode === "deny";
    }

    const denied = deniedRoots.some((root) => isWithinRoot(normalized.value, root));
    const allowed = allowedRoots.some((root) => isWithinRoot(normalized.value, root));

    return mode === "deny" ? denied || (deniedRoots.length === 0 && allowed) : allowed && !denied;
  });
}

export function commandRuleMatches(rules: readonly CommandRule[], facts: readonly ArgumentFact[]): boolean {
  const commandFacts = facts.filter(
    (fact): fact is Extract<ArgumentFact, { readonly kind: "command" }> => fact.kind === "command"
  );

  return commandFacts.some((fact) =>
    rules.some((rule) => executableMatches(rule.executable, fact.executable) && argvMatches(rule.argv, fact.argv))
  );
}

export function networkRuleMatches(rules: readonly NetworkRule[], facts: readonly ArgumentFact[]): boolean {
  const networkFacts = facts.filter(
    (fact): fact is Extract<ArgumentFact, { readonly kind: "network" }> => fact.kind === "network"
  );

  return networkFacts.some((fact) => {
    const normalized = normalizeNetworkValue(fact.value);
    if (!normalized.ok) {
      return false;
    }

    return rules.some((rule) => {
      const domainMatches = (rule.domains ?? []).some((domain) => hostMatchesDomain(normalized.host, domain));
      const ipMatches = normalized.ip ? (rule.ips ?? []).includes(normalized.ip) : false;
      return domainMatches || ipMatches;
    });
  });
}

export function secretRuleMatches(rule: SecretRule, facts: readonly ArgumentFact[]): boolean {
  const secretFacts = facts.filter((fact): fact is Extract<ArgumentFact, { readonly kind: "secret" }> => fact.kind === "secret");
  const labels = new Set(rule.labels.map((label) => normalizeSecretLabel(label)));

  return secretFacts.some((fact) => labels.has(normalizeSecretLabel(fact.label)));
}

export function hasFactKind(facts: readonly ArgumentFact[], kind: ArgumentFact["kind"]): boolean {
  return facts.some((fact) => fact.kind === kind);
}

function normalizeSecretLabel(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeRoots(values: readonly string[] | undefined): readonly string[] {
  return (values ?? [])
    .map((value) => normalizePathValue(value))
    .filter((value): value is { readonly ok: true; readonly value: string } => value.ok)
    .map((value) => value.value);
}

function normalizePathValue(value: string): { readonly ok: true; readonly value: string } | { readonly ok: false } {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes("\0") ||
    /%2f|%5c/i.test(trimmed) ||
    trimmed.split(/[\\/]+/u).includes("..")
  ) {
    return { ok: false };
  }

  const slashNormalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/");
  const segments = slashNormalized.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  const prefix = slashNormalized.startsWith("/") ? "/" : "";
  const driveMatch = segments[0]?.match(/^[a-zA-Z]:$/u);
  const normalizedSegments = driveMatch ? [segments[0]?.toLowerCase() ?? "", ...segments.slice(1)] : segments;

  return { ok: true, value: `${prefix}${normalizedSegments.join("/")}`.toLowerCase() };
}

function isWithinRoot(value: string, root: string): boolean {
  return value === root || value.startsWith(`${root.replace(/\/$/u, "")}/`);
}

function executableMatches(ruleExecutable: string, factExecutable: string): boolean {
  return basename(ruleExecutable).toLowerCase() === basename(factExecutable).toLowerCase();
}

function argvMatches(ruleArgv: readonly string[] | undefined, factArgv: readonly string[]): boolean {
  if (!ruleArgv) {
    return factArgv.length === 0;
  }

  if (ruleArgv.length !== factArgv.length) {
    return false;
  }

  return ruleArgv.every((part, index) => part === "*" || part === factArgv[index]);
}

function basename(value: string): string {
  return value.replace(/\\/g, "/").split("/").at(-1) ?? value;
}

function isDeniedShellCommand(fact: Extract<ArgumentFact, { readonly kind: "command" }>): boolean {
  const executable = basename(fact.executable).toLowerCase().replace(/\.exe$/u, "");
  const firstArg = fact.argv[0]?.toLowerCase();

  if (["sh", "bash", "zsh"].includes(executable)) {
    return firstArg === "-c";
  }

  if (["powershell", "pwsh"].includes(executable)) {
    return firstArg === "-command" || firstArg === "-c";
  }

  return executable === "cmd" && firstArg === "/c";
}

function normalizeNetworkValue(
  value: string
): { readonly ok: true; readonly host: string; readonly ip?: string } | { readonly ok: false } {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /\s/u.test(trimmed)) {
    return { ok: false };
  }

  try {
    const parsed = trimmed.includes("://") ? new URL(trimmed) : new URL(`msp://${trimmed}`);
    if (parsed.username || parsed.password || !parsed.hostname) {
      return { ok: false };
    }

    const host = parsed.hostname.toLowerCase();
    return isIpAddress(host) ? { ok: true, host, ip: host } : { ok: true, host };
  } catch {
    return { ok: false };
  }
}

function hostMatchesDomain(host: string, domain: string): boolean {
  const normalizedDomain = domain.trim().toLowerCase();
  if (normalizedDomain.length === 0) {
    return false;
  }

  return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
}

function isIpAddress(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value) || value.includes(":");
}
