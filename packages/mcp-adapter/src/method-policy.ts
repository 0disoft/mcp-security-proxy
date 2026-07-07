import type { PolicyDecision, PolicyDocument } from "@0disoft/mcp-security-proxy-contracts";
import { evaluateMcpMethod } from "@0disoft/mcp-security-proxy-core";
import { getRequestMethod } from "./jsonrpc.js";

export function evaluateEnvelopeMethod(envelope: unknown, policy: PolicyDocument): PolicyDecision {
  const method = getRequestMethod(envelope);
  if (!method) {
    return {
      schemaVersion: "msp.decision.v1",
      action: "deny",
      evidence: [{ code: "jsonrpc.invalid", reason: "JSON-RPC request method missing or invalid" }]
    };
  }

  return evaluateMcpMethod(method, policy);
}
