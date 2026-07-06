import {
  DECISION_SCHEMA_VERSION,
  type Capability,
  type NormalizedToolCall,
  type PolicyDecision,
  type PolicyDocument,
  type PolicyRule
} from "@0disoft/mcp-security-proxy-contracts";

export interface EvaluateToolCallOptions {
  readonly policy: PolicyDocument;
  readonly profileId: string;
  readonly call: NormalizedToolCall;
}

export function evaluateToolCall(options: EvaluateToolCallOptions): PolicyDecision {
  const profile = options.policy.profiles.find((item) => item.id === options.profileId);
  if (!profile) {
    return deny("profile not found");
  }

  for (const action of ["deny", "approval_required", "allow"] as const) {
    const rule = profile.rules.find((candidate) => candidate.action === action && ruleMatches(candidate, options.call));
    if (rule) {
      return {
        schemaVersion: DECISION_SCHEMA_VERSION,
        action,
        evidence: [
          {
            ruleId: rule.id,
            ...withCapability(firstMatchingCapability(rule, options.call)),
            reason: `matched ${action} rule`
          }
        ]
      };
    }
  }

  return deny("default deny");
}

function ruleMatches(rule: PolicyRule, call: NormalizedToolCall): boolean {
  const toolMatches = !rule.tools || rule.tools.includes(call.toolName);
  const capabilityMatches =
    !rule.capabilities || call.capabilities.some((capability) => rule.capabilities?.includes(capability));
  const methodMatches = !rule.methods || rule.methods.includes(call.method);

  return toolMatches && capabilityMatches && methodMatches;
}

function firstMatchingCapability(rule: PolicyRule, call: NormalizedToolCall): Capability | undefined {
  return call.capabilities.find((capability) => rule.capabilities?.includes(capability));
}

function withCapability(capability: Capability | undefined): { readonly capability: Capability } | Record<string, never> {
  return capability ? { capability } : {};
}

function deny(reason: string): PolicyDecision {
  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    action: "deny",
    evidence: [{ reason }]
  };
}
