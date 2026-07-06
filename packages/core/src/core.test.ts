import { describe, expect, it } from "vitest";
import { createDenyByDefaultPolicy } from "@0disoft/mcp-security-proxy-contracts";
import { createAuditEvent } from "./audit.js";
import { evaluateToolCall } from "./evaluator.js";
import { evaluateMcpMethod } from "./method-policy.js";
import { redactText } from "./redactor.js";

describe("MCP Security Proxy core", () => {
  it("denies unsupported MCP methods by default", () => {
    const policy = createDenyByDefaultPolicy();
    const decision = evaluateMcpMethod("resources/list", policy);

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.reason).toContain("unsupported MCP method");
  });

  it("keeps default tool-call behavior deny-by-default", () => {
    const policy = createDenyByDefaultPolicy("local");
    const decision = evaluateToolCall({
      policy,
      profileId: "local",
      call: {
        method: "tools/call",
        toolName: "read_file",
        capabilities: ["file-read"],
        argumentFacts: [{ kind: "path", value: "workspace/readme.md" }]
      }
    });

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.reason).toBe("default deny");
  });

  it("applies deny rules before allow rules", () => {
    const policy = {
      ...createDenyByDefaultPolicy("local"),
      profiles: [
        {
          id: "local",
          defaultAction: "deny" as const,
          audit: {
            destination: "stdout" as const,
            onFailure: "fail_closed" as const,
            includeRawArguments: false as const,
            includeFullPaths: false
          },
          rules: [
            { id: "allow-files", action: "allow" as const, capabilities: ["file-read" as const] },
            { id: "deny-files", action: "deny" as const, capabilities: ["file-read" as const] }
          ]
        }
      ]
    };

    const decision = evaluateToolCall({
      policy,
      profileId: "local",
      call: {
        method: "tools/call",
        toolName: "read_file",
        capabilities: ["file-read"],
        argumentFacts: []
      }
    });

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.ruleId).toBe("deny-files");
  });

  it("redacts secret-like text before audit event creation", () => {
    const redacted = redactText("value TOKEN_VALUE_123");
    const policy = createDenyByDefaultPolicy("local");
    const decision = evaluateMcpMethod("resources/list", policy);
    const event = createAuditEvent({
      kind: "method-denied",
      profileId: "local",
      method: "resources/list",
      decision,
      redaction: redacted.summary
    });

    expect(redacted.value).not.toContain("TOKEN_VALUE_123");
    expect(event.redaction.counts.secret_like).toBe(1);
  });
});
