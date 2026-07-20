import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createDenyByDefaultPolicy,
  type NormalizedToolCall,
  type PolicyDocument,
  validatePolicyDocument
} from "@0disoft/mcp-security-proxy-contracts";
import { createAuditEvent, formatAuditEventJsonLine } from "./audit.js";
import { classifyToolDescriptor } from "./classifier.js";
import { evaluateToolCall } from "./evaluator.js";
import { evaluateMcpMethod } from "./method-policy.js";
import { redactText } from "./redactor.js";
import { toolHasNonDenyPolicyCoverage } from "./tool-policy-coverage.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("MCP Security Proxy core", () => {
  it("denies unsupported MCP methods by default", () => {
    const policy = createDenyByDefaultPolicy();
    const decision = evaluateMcpMethod("resources/list", policy);

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.code).toBe("method.unsupported");
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
    expect(decision.evidence[0]?.code).toBe("policy.default_deny");
    expect(decision.evidence[0]?.reason).toBe("default deny");
  });

  it("allows file-read only when a path matcher explicitly allows the root", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: readFixture<NormalizedToolCall>("fixtures/mcp/call-file-read-allowed.json")
    });

    expect(decision.action).toBe("allow");
    expect(decision.evidence[0]?.code).toBe("policy.rule_allow");
    expect(decision.evidence[0]?.ruleId).toBe("allow-public-files");
  });

  it("requires every classified capability to receive a non-deny decision", () => {
    const policy = policyWithRule({
      id: "allow-file-read",
      action: "allow",
      capabilities: ["file-read"]
    });
    const profile = policy.profiles.find((item) => item.id === "local");
    if (!profile) {
      throw new Error("local profile missing");
    }

    const decision = evaluateToolCall({
      policy,
      profileId: "local",
      call: {
        method: "tools/call",
        toolName: "read_file_command",
        capabilities: ["file-read", "shell"],
        argumentFacts: []
      }
    });

    expect(decision).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.default_deny", capability: "shell" }]
    });
    expect(toolHasNonDenyPolicyCoverage(profile.rules, "read_file_command", ["file-read", "shell"])).toBe(false);
  });

  it("allows multi-capability calls only when every capability is covered", () => {
    const policy = readFixture<PolicyDocument>("fixtures/policies/local-dev.json");
    const profile = policy.profiles.find((item) => item.id === "local");
    if (!profile) {
      throw new Error("local profile missing");
    }
    const rules = [
      { id: "allow-file-read", action: "allow", capabilities: ["file-read"] },
      { id: "allow-shell", action: "allow", capabilities: ["shell"] }
    ] as const;
    const multiCapabilityPolicy: PolicyDocument = {
      ...policy,
      profiles: policy.profiles.map((item) => (item.id === "local" ? { ...item, rules } : item))
    };

    expect(
      evaluateToolCall({
        policy: multiCapabilityPolicy,
        profileId: "local",
        call: {
          method: "tools/call",
          toolName: "read_file_command",
          capabilities: ["file-read", "shell"],
          argumentFacts: []
        }
      })
    ).toMatchObject({ action: "allow" });
    expect(toolHasNonDenyPolicyCoverage(rules, "read_file_command", ["file-read", "shell"])).toBe(true);
  });

  it("denies file-read when any path fact falls outside the allow root", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: {
        method: "tools/call",
        toolName: "read_file",
        capabilities: ["file-read"],
        argumentFacts: [
          { kind: "path", value: "workspace/public/readme.md" },
          { kind: "path", value: "workspace/separate/report.md" }
        ]
      }
    });

    expect(decision).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.default_deny", reason: "default deny" }]
    });
  });

  it("applies deny rules before allow rules for denied roots", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: readFixture<NormalizedToolCall>("fixtures/mcp/call-file-read-denied.json")
    });

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.code).toBe("policy.rule_deny");
    expect(decision.evidence[0]?.ruleId).toBe("deny-private-files");
  });

  it("fails closed on ambiguous path traversal", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: readFixture<NormalizedToolCall>("fixtures/mcp/call-file-read-traversal.json")
    });

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.code).toBe("policy.ambiguous_path");
    expect(decision.evidence[0]?.reason).toBe("ambiguous path denied by default");
  });

  it("does not fold path segment case into an allow-root match", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: {
        method: "tools/call",
        toolName: "read_file",
        capabilities: ["file-read"],
        argumentFacts: [{ kind: "path", value: "workspace/Public/readme.md" }]
      }
    });

    expect(decision).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.default_deny", reason: "default deny" }]
    });
  });

  it("fails closed on path forms that require host filesystem expansion", () => {
    const homePathDecision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: {
        method: "tools/call",
        toolName: "read_file",
        capabilities: ["file-read"],
        argumentFacts: [{ kind: "path", value: "~/workspace/public/readme.md" }]
      }
    });
    const uncDecision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: {
        method: "tools/call",
        toolName: "read_file",
        capabilities: ["file-read"],
        argumentFacts: [{ kind: "path", value: "\\\\server\\share\\readme.md" }]
      }
    });

    expect(homePathDecision).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.ambiguous_path", reason: "ambiguous path denied by default" }]
    });
    expect(uncDecision).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.ambiguous_path", reason: "ambiguous path denied by default" }]
    });
  });

  it("denies free-form shell wrappers before rule evaluation", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: readFixture<NormalizedToolCall>("fixtures/mcp/call-shell-denied.json")
    });

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]?.code).toBe("policy.free_form_shell");
    expect(decision.evidence[0]?.reason).toBe("free-form shell command denied by default");
  });

  it("does not collapse an absolute executable policy to a bare basename", () => {
    const policy = policyWithRule({
      id: "allow-system-git",
      action: "allow",
      capabilities: ["shell"],
      commands: [{ executable: "/usr/bin/git", argv: ["status"] }]
    });

    expect(
      evaluateToolCall({
        policy,
        profileId: "local",
        call: {
          method: "tools/call",
          toolName: "run_command",
          capabilities: ["shell"],
          argumentFacts: [{ kind: "command", executable: "git", argv: ["status"] }]
        }
      })
    ).toMatchObject({ action: "deny", evidence: [{ code: "policy.default_deny" }] });
  });

  it("matches each command argv wildcard to exactly one argument", () => {
    const policy = policyWithRule({
      id: "allow-git-show",
      action: "allow",
      capabilities: ["shell"],
      commands: [{ executable: "git", argv: ["show", "*"] }]
    });
    const evaluateArgv = (argv: readonly string[]) =>
      evaluateToolCall({
        policy,
        profileId: "local",
        call: {
          method: "tools/call",
          toolName: "run_command",
          capabilities: ["shell"],
          argumentFacts: [{ kind: "command", executable: "git", argv }]
        }
      });

    expect(evaluateArgv(["show", "HEAD"])).toMatchObject({
      action: "allow",
      evidence: [{ code: "policy.rule_allow", ruleId: "allow-git-show" }]
    });
    expect(evaluateArgv(["show"])).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.default_deny" }]
    });
    expect(evaluateArgv(["show", "HEAD", "--stat"])).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.default_deny" }]
    });
  });

  it("denies interpreter inline-code flags before shell allow rules can match", () => {
    const policy = policyWithRule({
      id: "allow-shell",
      action: "allow",
      capabilities: ["shell"]
    });
    for (const [executable, argv] of [
      ["python", ["-c", "print(1)"]],
      ["python3", ["-c", "print(1)"]],
      ["node", ["-e", "console.log(1)"]],
      ["ruby", ["-e", "puts 1"]],
      ["perl", ["-e", "print 1"]],
      ["php", ["-r", "echo 1;"]],
      ["lua", ["-e", "print(1)"]]
    ] as const) {
      const decision = evaluateToolCall({
        policy,
        profileId: "local",
        call: {
          method: "tools/call",
          toolName: "run_command",
          capabilities: ["shell"],
          argumentFacts: [{ kind: "command", executable, argv }]
        }
      });

      expect(decision, executable).toMatchObject({
        action: "deny",
        evidence: [{ code: "policy.free_form_shell" }]
      });
    }
  });

  it("matches network facts only through argument-level network policy", () => {
    const policy = readFixture<PolicyDocument>("fixtures/policies/local-dev.json");

    expect(
      evaluateToolCall({
        policy,
        profileId: "local",
        call: readFixture<NormalizedToolCall>("fixtures/mcp/call-network-allowed.json")
      })
    ).toMatchObject({
      action: "allow",
      evidence: [{ code: "policy.rule_allow" }]
    });

    expect(
      evaluateToolCall({
        policy,
        profileId: "local",
        call: readFixture<NormalizedToolCall>("fixtures/mcp/call-network-denied.json")
      })
    ).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.default_deny" }]
    });
  });

  it("denies network calls when any network fact falls outside the allowlist", () => {
    const policy = readFixture<PolicyDocument>("fixtures/policies/local-dev.json");
    const decision = evaluateToolCall({
      policy,
      profileId: "local",
      call: {
        method: "tools/call",
        toolName: "fetch_url",
        capabilities: ["network"],
        argumentFacts: [
          { kind: "network", value: "https://api.example.com/v1" },
          { kind: "network", value: "https://outside.example.test/v1" }
        ]
      }
    });

    expect(decision).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.default_deny", reason: "default deny" }]
    });
  });

  it("fails closed on ambiguous network targets before rule evaluation", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: readFixture<NormalizedToolCall>("fixtures/mcp/call-network-ambiguous.json")
    });

    expect(decision).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.ambiguous_network", reason: "ambiguous network target denied by default" }]
    });
  });

  it("normalizes alternate localhost IP forms before network rule matching", () => {
    const policy = policyWithRule({
      id: "deny-localhost",
      action: "deny",
      capabilities: ["network"],
      networks: [{ ips: ["127.0.0.1"] }]
    });

    for (const value of [
      "http://2130706433/admin",
      "http://0x7f000001/admin",
      "http://0177.0.0.1/admin",
      "http://[::ffff:127.0.0.1]/admin"
    ]) {
      const decision = evaluateToolCall({
        policy,
        profileId: "local",
        call: {
          method: "tools/call",
          toolName: "fetch_url",
          capabilities: ["network"],
          argumentFacts: [{ kind: "network", value }]
        }
      });

      expect(decision, value).toMatchObject({
        action: "deny",
        evidence: [{ code: "policy.rule_deny", ruleId: "deny-localhost" }]
      });
    }
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
    expect(evaluateToolCall({ policy, profileId: "local", call })).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.approval_hook_missing" }]
    });
    expect(evaluateToolCall({ policy, profileId: "local", call, approvalHookAvailable: true })).toMatchObject({
      action: "approval_required",
      evidence: [{ code: "policy.rule_approval_required" }]
    });
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
    expect(decision.evidence[0]?.code).toBe("policy.unknown_capability");
    expect(decision.evidence[0]?.reason).toBe("unknown capability denied by default");
  });

  it("denies secret argument facts unless the tool explicitly declares secret capability", () => {
    const decision = evaluateToolCall({
      policy: readFixture<PolicyDocument>("fixtures/policies/local-dev.json"),
      profileId: "local",
      call: {
        method: "tools/call",
        toolName: "read_file",
        capabilities: ["file-read"],
        argumentFacts: [
          { kind: "path", value: "workspace/public/readme.md" },
          { kind: "secret", label: "api-key" }
        ]
      }
    });

    expect(decision.action).toBe("deny");
    expect(decision.evidence[0]).toMatchObject({
      code: "policy.secret_capability_required",
      capability: "secret",
      reason: "secret-sensitive argument requires explicit secret capability"
    });
  });

  it("matches secret argument labels through explicit secret policy", () => {
    const policy = policyWithRule({
      id: "allow-api-key-secret",
      action: "allow",
      capabilities: ["secret"],
      secrets: {
        labels: ["api-key"]
      }
    });

    expect(
      evaluateToolCall({
        policy,
        profileId: "local",
        call: {
          method: "tools/call",
          toolName: "read_secret",
          capabilities: ["secret"],
          argumentFacts: [{ kind: "secret", label: "api-key" }]
        }
      })
    ).toMatchObject({
      action: "allow",
      evidence: [{ code: "policy.rule_allow", ruleId: "allow-api-key-secret", capability: "secret" }]
    });

    expect(
      evaluateToolCall({
        policy,
        profileId: "local",
        call: {
          method: "tools/call",
          toolName: "read_secret",
          capabilities: ["secret"],
          argumentFacts: [{ kind: "secret", label: "token" }]
        }
      })
    ).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.default_deny" }]
    });
  });

  it("denies secret calls when any secret label is not explicitly allowed", () => {
    const policy = policyWithRule({
      id: "allow-api-key-secret",
      action: "allow",
      capabilities: ["secret"],
      secrets: {
        labels: ["api-key"]
      }
    });

    const decision = evaluateToolCall({
      policy,
      profileId: "local",
      call: {
        method: "tools/call",
        toolName: "read_secret",
        capabilities: ["secret"],
        argumentFacts: [
          { kind: "secret", label: "api-key" },
          { kind: "secret", label: "token" }
        ]
      }
    });

    expect(decision).toMatchObject({
      action: "deny",
      evidence: [{ code: "policy.default_deny", reason: "default deny" }]
    });
  });

  it("classifies secret-like tool descriptors without treating api alone as a secret", () => {
    const secretTool = classifyToolDescriptor({
      name: "read_secret",
      description: "Read a secret reference by label."
    });
    const apiCatalogTool = classifyToolDescriptor({
      name: "list_api_catalog",
      description: "List API endpoints for documentation."
    });

    expect(secretTool.descriptor.capabilities).toContain("secret");
    expect(secretTool.evidence).toContainEqual({
      capability: "secret",
      source: "name",
      reason: "tool text mentions secret-like material"
    });
    expect(apiCatalogTool.descriptor.capabilities).not.toContain("secret");
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

  it("redacts common token and environment assignment shapes", () => {
    const openAiPrefix = "sk";
    const redacted = redactText(
      [
        `value ${openAiPrefix}-abcdefghijklmnopqrstuvwxyz`,
        "header Bearer abcdefghijklmnop",
        `env api${"_"}key=value`,
        "path workspace/private/secret.txt"
      ].join(" ")
    );

    expect(redacted.value).not.toContain(`${openAiPrefix}-abcdefghijklmnopqrstuvwxyz`);
    expect(redacted.value).not.toContain("Bearer abcdefghijklmnop");
    expect(redacted.value).not.toContain(`api${"_"}key=value`);
    expect(redacted.value).not.toContain("workspace/private/secret.txt");
    expect(redacted.summary.counts.secret_like).toBe(3);
    expect(redacted.summary.counts.path).toBe(1);
  });

  it("uses policy redaction detector replacements for configured detector kinds", () => {
    const redacted = redactText(
      "token=RAW_POLICY_REDACTION_MARKER PROMPT: summarize private notes; WORKSPACE_ID=abc123",
      {
        detectors: [
          {
            id: "custom-secret",
            kind: "secret_like",
            replacement: "[SECRET_VALUE]"
          },
          {
            id: "custom-prompt",
            kind: "prompt",
            replacement: "[PROMPT_VALUE]"
          },
          {
            id: "custom-env",
            kind: "environment_value",
            replacement: "[ENV_VALUE]"
          }
        ]
      }
    );

    expect(redacted.value).toContain("[SECRET_VALUE]");
    expect(redacted.value).toContain("[PROMPT_VALUE]");
    expect(redacted.value).toContain("[ENV_VALUE]");
    expect(redacted.value).not.toContain("RAW_POLICY_REDACTION_MARKER");
    expect(redacted.value).not.toContain("private notes");
    expect(redacted.value).not.toContain("WORKSPACE_ID=abc123");
    expect(redacted.summary.counts).toMatchObject({
      secret_like: 1,
      prompt: 1,
      environment_value: 1
    });
  });

  it("formats audit events as one JSON Lines record without reintroducing raw values", () => {
    const redacted = redactText("value REDACT_ME_AUDIT_JSONL_MARKER");
    const policy = readFixture<PolicyDocument>("fixtures/policies/local-dev.json");
    const event = createAuditEvent({
      kind: "method-denied",
      profileId: "local",
      method: "resources/list",
      decision: evaluateMcpMethod("resources/list", policy),
      redaction: redacted.summary
    });
    const line = formatAuditEventJsonLine(event);

    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(line).not.toContain("REDACT_ME_AUDIT_JSONL_MARKER");
    expect(JSON.parse(line)).toMatchObject({
      schemaVersion: "msp.audit-event.v1",
      kind: "method-denied",
      redaction: {
        applied: true,
        counts: {
          secret_like: 1
        }
      }
    });
  });

  it("keeps denied audit event snapshots redacted", () => {
    const snapshot = readTextFixture("fixtures/audit/decision-denied.redacted.jsonl");

    expect(snapshot).toContain('"action":"deny"');
    expect(snapshot).toContain('"secret_like":1');
    expect(snapshot).not.toContain("REDACT_ME_VALUE_123");
  });

  it("rejects policy documents with ambiguous duplicate identifiers and empty matchers", () => {
    const policy = readFixture<PolicyDocument>("fixtures/policies/local-dev.json");
    const profile = policy.profiles[0];
    if (!profile) {
      throw new Error("local-dev fixture must include a profile");
    }
    const invalid = {
      ...policy,
      methodPolicy: {
        ...policy.methodPolicy,
        allowedMethods: [...policy.methodPolicy.allowedMethods, "ping"]
      },
      profiles: [
        {
          ...profile,
          rules: [
            ...profile.rules,
            {
              id: "allow-public-files",
              action: "allow",
              capabilities: []
            },
            {
              id: "empty-matcher",
              action: "deny",
              networks: [{}]
            },
            {
              id: "empty-secret-labels",
              action: "allow",
              secrets: {
                labels: []
              }
            }
          ]
        },
        {
          ...profile
        }
      ],
      redaction: {
        detectors: [
          {
            id: "same-detector",
            kind: "secret_like",
            replacement: "[REDACTED_VALUE]"
          },
          {
            id: "same-detector",
            kind: "not-real",
            replacement: "[REDACTED_VALUE]"
          }
        ]
      }
    };

    const result = validatePolicyDocument(invalid);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain("duplicate method in methodPolicy.allowedMethods: ping");
      expect(result.errors).toContain("duplicate profile id: local");
      expect(result.errors).toContain("profiles[0].rules[5].id must be unique within the profile");
      expect(result.errors).toContain("profiles[0].rules[5].capabilities must be a non-empty array");
      expect(result.errors).toContain("profiles[0].rules[6].networks[0] must include domains or ips");
      expect(result.errors).toContain("profiles[0].rules[7].secrets.labels must be a non-empty array");
      expect(result.errors).toContain("redaction.detectors[1].id must be unique");
      expect(result.errors).toContain("redaction.detectors[1].kind is unsupported");
    }
  });
});

function policyWithRule(rule: PolicyDocument["profiles"][number]["rules"][number]): PolicyDocument {
  const policy = readFixture<PolicyDocument>("fixtures/policies/local-dev.json");
  return {
    ...policy,
    profiles: policy.profiles.map((profile) =>
      profile.id === "local"
        ? {
            ...profile,
            rules: [rule]
          }
        : profile
    )
  };
}

function readFixture<T>(path: string): T {
  return JSON.parse(readTextFixture(path)) as T;
}

function readTextFixture(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}
