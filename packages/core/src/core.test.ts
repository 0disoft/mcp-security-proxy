import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createDenyByDefaultPolicy,
  type NormalizedToolCall,
  type PolicyDocument
} from "@0disoft/mcp-security-proxy-contracts";
import { createAuditEvent } from "./audit.js";
import { evaluateToolCall } from "./evaluator.js";
import { evaluateMcpMethod } from "./method-policy.js";
import { redactText } from "./redactor.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("MCP Security Proxy core", () => {
  it("denies unsupported MCP methods by default", () => {
    const policy = createDenyByDefaultPolicy();
    const decision = evaluateMcpMethod("resources/list", policy);

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.reason).toContain("unsupported MCP method");
  });

  it("keeps default tool-call behavior deny-by-default", () => {
    const policy = readFixture<PolicyDocument>("fixtures/policies/deny-by-default.json");
    const decision = evaluateToolCall({
      policy,
      profileId: "local",
      call: readFixture<NormalizedToolCall>("fixtures/mcp/call-file-read-allowed.json")
    });

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.reason).toBe("default deny");
  });

  it("allows file-read only when a path matcher explicitly allows the root", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: readFixture<NormalizedToolCall>("fixtures/mcp/call-file-read-allowed.json")
    });

    expect(decision.action).toBe("allow");
    expect(decision.evidence[0]?.ruleId).toBe("allow-public-files");
  });

  it("applies deny rules before allow rules for denied roots", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: readFixture<NormalizedToolCall>("fixtures/mcp/call-file-read-denied.json")
    });

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.ruleId).toBe("deny-private-files");
  });

  it("fails closed on ambiguous path traversal", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: readFixture<NormalizedToolCall>("fixtures/mcp/call-file-read-traversal.json")
    });

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.reason).toBe("ambiguous path denied by default");
  });

  it("denies free-form shell wrappers before rule evaluation", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: readFixture<NormalizedToolCall>("fixtures/mcp/call-shell-denied.json")
    });

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.reason).toBe("free-form shell command denied by default");
  });

  it("matches network facts only through argument-level network policy", () => {
    const policy = readFixture<PolicyDocument>("fixtures/policies/local-dev.json");

    expect(
      evaluateToolCall({
        policy,
        profileId: "local",
        call: readFixture<NormalizedToolCall>("fixtures/mcp/call-network-allowed.json")
      }).action
    ).toBe("allow");

    expect(
      evaluateToolCall({
        policy,
        profileId: "local",
        call: readFixture<NormalizedToolCall>("fixtures/mcp/call-network-denied.json")
      }).action
    ).toBe("deny");
  });

  it("turns approval-required into deny when no approval hook is available", () => {
    const policy = readFixture<PolicyDocument>("fixtures/policies/local-dev.json");
    const call: NormalizedToolCall = {
      method: "tools/call",
      toolName: "run_workflow",
      capabilities: ["workflow"],
      argumentFacts: []
    };

    expect(evaluateToolCall({ policy, profileId: "local", call }).action).toBe("deny");
    expect(evaluateToolCall({ policy, profileId: "local", call, approvalHookAvailable: true }).action).toBe(
      "approval_required"
    );
  });

  it("denies unknown capability before classifier hints can grant permission", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: {
        method: "tools/call",
        toolName: "unknown_tool",
        capabilities: ["unknown"],
        argumentFacts: []
      }
    });

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.reason).toBe("unknown capability denied by default");
  });

  it("redacts secret-like text before audit event creation", () => {
    const redacted = redactText("value REDACT_ME_VALUE_123");
    const policy = readFixture<PolicyDocument>("fixtures/policies/local-dev.json");
    const decision = evaluateMcpMethod("resources/list", policy);
    const event = createAuditEvent({
      kind: "method-denied",
      profileId: "local",
      method: "resources/list",
      decision,
      redaction: redacted.summary
    });

    expect(redacted.value).not.toContain("REDACT_ME_VALUE_123");
    expect(event.redaction.counts.secret_like).toBe(1);
  });

  it("keeps denied audit event snapshots redacted", () => {
    const snapshot = readTextFixture("fixtures/audit/decision-denied.redacted.jsonl");

    expect(snapshot).toContain('"action":"deny"');
    expect(snapshot).toContain('"secret_like":1');
    expect(snapshot).not.toContain("REDACT_ME_VALUE_123");
  });
});

function readFixture<T>(path: string): T {
  return JSON.parse(readTextFixture(path)) as T;
}

function readTextFixture(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}
