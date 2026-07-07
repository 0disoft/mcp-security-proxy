import {
  DECISION_SCHEMA_VERSION,
  type Capability,
  type DecisionEvidence,
  type NormalizedToolCall,
  type PolicyDecision,
  type PolicyDocument,
  type PolicyRule
} from "@0disoft/mcp-security-proxy-contracts";
import {
  commandRuleMatches,
  findBlockingArgumentIssue,
  hasFactKind,
  networkRuleMatches,
  pathRuleMatches
} from "./matchers.js";

export interface EvaluateToolCallOptions {
  readonly policy: PolicyDocument;
  readonly profileId: string;
  readonly call: NormalizedToolCall;
  readonly approvalHookAvailable?: boolean;
}

export function evaluateToolCall(options: EvaluateToolCallOptions): PolicyDecision {
  const profile = options.policy.profiles.find((item) => item.id === options.profileId);
  if (!profile) {
    return deny("profile not found", undefined, "policy.profile_not_found");
  }

  const blockingIssue = findBlockingArgumentIssue(options.call.argumentFacts);
  if (blockingIssue) {
    return deny(blockingIssue.reason, capabilityForFactKind(blockingIssue.kind));
  }

  if (hasFactKind(options.call.argumentFacts, "secret") && !options.call.capabilities.includes("secret")) {
    return deny("secret-sensitive argument requires explicit secret capability", "secret");
  }

  if (options.call.capabilities.includes("unknown")) {
    return deny("unknown capability denied by default", "unknown");
  }

  for (const action of ["deny", "approval_required", "allow"] as const) {
    const rule = profile.rules.find((candidate) => candidate.action === action && ruleMatches(candidate, options.call));
    if (rule) {
      const evidence: DecisionEvidence = {
        ruleId: rule.id,
        ...withCapability(firstMatchingCapability(rule, options.call)),
        reason: `matched ${action} rule`
      };

      if (action === "approval_required" && !options.approvalHookAvailable) {
        return {
          schemaVersion: DECISION_SCHEMA_VERSION,
          action: "deny",
          evidence: [
            {
              ...evidence,
              code: "policy.approval_hook_missing",
              reason: "approval required but no approval hook is available"
            }
          ]
        };
      }

      return {
        schemaVersion: DECISION_SCHEMA_VERSION,
        action,
        evidence: [evidence]
      };
    }
  }

  return deny("default deny", undefined, "policy.default_deny");
}

function ruleMatches(rule: PolicyRule, call: NormalizedToolCall): boolean {
  const toolMatches = !rule.tools || rule.tools.includes(call.toolName);
  const capabilityMatches =
    !rule.capabilities || call.capabilities.some((capability) => rule.capabilities?.includes(capability));
  const methodMatches = !rule.methods || rule.methods.includes(call.method);
  const pathMatches = matcherMatches("path", rule, call);
  const commandMatches = matcherMatches("command", rule, call);
  const networkMatches = matcherMatches("network", rule, call);

  return toolMatches && capabilityMatches && methodMatches && pathMatches && commandMatches && networkMatches;
}

function firstMatchingCapability(rule: PolicyRule, call: NormalizedToolCall): Capability | undefined {
  return call.capabilities.find((capability) => rule.capabilities?.includes(capability));
}

function withCapability(capability: Capability | undefined): { readonly capability: Capability } | Record<string, never> {
  return capability ? { capability } : {};
}

function matcherMatches(kind: "path" | "command" | "network", rule: PolicyRule, call: NormalizedToolCall): boolean {
  if (kind === "path") {
    return factMatcherMatches(rule.action, hasFactKind(call.argumentFacts, "path"), Boolean(rule.paths), () =>
      rule.paths ? pathRuleMatches(rule.paths, call.argumentFacts, rule.action === "deny" ? "deny" : "allow") : false
    );
  }

  if (kind === "command") {
    return factMatcherMatches(rule.action, hasFactKind(call.argumentFacts, "command"), Boolean(rule.commands), () =>
      rule.commands ? commandRuleMatches(rule.commands, call.argumentFacts) : false
    );
  }

  return factMatcherMatches(rule.action, hasFactKind(call.argumentFacts, "network"), Boolean(rule.networks), () =>
    rule.networks ? networkRuleMatches(rule.networks, call.argumentFacts) : false
  );
}

function factMatcherMatches(
  action: PolicyRule["action"],
  hasFact: boolean,
  hasRuleMatcher: boolean,
  match: () => boolean
): boolean {
  if (!hasFact && !hasRuleMatcher) {
    return true;
  }

  if (action === "deny" && hasFact && !hasRuleMatcher) {
    return true;
  }

  if (hasFact !== hasRuleMatcher) {
    return false;
  }

  return match();
}

function capabilityForFactKind(kind: "path" | "command" | "network" | "secret"): Capability {
  if (kind === "path") {
    return "file-read";
  }
  if (kind === "command") {
    return "shell";
  }
  if (kind === "network") {
    return "network";
  }
  return "secret";
}

function deny(reason: string, capability?: Capability, code?: DecisionEvidence["code"]): PolicyDecision {
  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    action: "deny",
    evidence: [{ ...withCapability(capability), ...(code ? { code } : {}), reason }]
  };
}
