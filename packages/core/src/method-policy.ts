import {
  DECISION_SCHEMA_VERSION,
  type NormalizedMcpMethod,
  type PolicyDecision,
  type PolicyDocument
} from "@0disoft/mcp-security-proxy-contracts";

export function normalizeMcpMethod(method: string, policy: PolicyDocument): NormalizedMcpMethod {
  return {
    method,
    supported: policy.methodPolicy.allowedMethods.includes(method)
  };
}

export function evaluateMcpMethod(method: string, policy: PolicyDocument): PolicyDecision {
  const normalized = normalizeMcpMethod(method, policy);

  if (normalized.supported) {
    return {
      schemaVersion: DECISION_SCHEMA_VERSION,
      action: "allow",
      evidence: [
        {
          method,
          reason: "method is explicitly supported by policy"
        }
      ]
    };
  }

  return {
    schemaVersion: DECISION_SCHEMA_VERSION,
    action: "deny",
    evidence: [
      {
        method,
        reason: policy.methodPolicy.denyUnsupported
          ? "unsupported MCP method denied by default"
          : "method is not in the supported method set"
      }
    ]
  };
}
