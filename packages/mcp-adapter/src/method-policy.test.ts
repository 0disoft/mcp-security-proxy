import { describe, expect, it } from "vitest";
import { createDenyByDefaultPolicy } from "@0disoft/mcp-security-proxy-contracts";
import { evaluateEnvelopeMethod } from "./method-policy.js";

describe("MCP adapter method policy", () => {
  it("denies invalid JSON-RPC request envelopes with a stable evidence code", () => {
    const decision = evaluateEnvelopeMethod({ jsonrpc: "2.0", method: 42 }, createDenyByDefaultPolicy());

    expect(decision).toMatchObject({
      schemaVersion: "msp.decision.v1",
      action: "deny",
      evidence: [
        {
          code: "jsonrpc.invalid",
          reason: "JSON-RPC request method missing or invalid"
        }
      ]
    });
  });

  it("delegates valid request methods to the core method policy", () => {
    const decision = evaluateEnvelopeMethod({ jsonrpc: "2.0", method: "resources/list" }, createDenyByDefaultPolicy());

    expect(decision).toMatchObject({
      action: "deny",
      evidence: [
        {
          code: "method.unsupported",
          method: "resources/list"
        }
      ]
    });
  });
});
