import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PolicyDocument } from "@0disoft/mcp-security-proxy-contracts";
import { createProxySession } from "./session.js";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("proxy runtime session", () => {
  it("rejects client messages with invalid JSON-RPC id types", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: { nested: 1 },
        method: "tools/list"
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        data: {
          decision: {
            action: "deny",
            evidence: [{ reason: "JSON-RPC id must be a string, number, null, or absent" }]
          }
        }
      }
    });
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: { action: "deny" }
    });
  });

  it("rejects client messages with invalid JSON-RPC method types", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: 7
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        data: {
          decision: {
            action: "deny",
            evidence: [{ reason: "JSON-RPC method must be a string when present" }]
          }
        }
      }
    });
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: { action: "deny" }
    });
  });

  it("drops upstream server messages with invalid JSON-RPC envelope fields", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: [1],
        result: {
          tools: [{ name: "read_file" }]
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ reason: "JSON-RPC id must be a string, number, null, or absent" }]
      }
    });
  });

  it("drops upstream responses that include both result and error", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-both",
        method: "tools/list"
      })
    );

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-both",
        result: readJsonFixture("fixtures/mcp/tools-list-basic.json"),
        error: {
          code: -32000,
          message: "RAW_RESPONSE_ERROR_MARKER"
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_RESPONSE_ERROR_MARKER");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ reason: "JSON-RPC response must include exactly one of result or error" }]
      }
    });

    const call = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "call-after-invalid-response",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );

    expect(call.forwardLine).toBeUndefined();
    expect(JSON.parse(call.responseLine ?? "{}")).toMatchObject({
      id: "call-after-invalid-response",
      error: {
        data: {
          decision: {
            action: "deny",
            evidence: [{ reason: "tool was not visible in filtered discovery" }]
          }
        }
      }
    });
  });

  it("drops upstream responses that include neither result nor error", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "empty-response"
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ reason: "JSON-RPC response must include exactly one of result or error" }]
      }
    });
  });

  it("drops valid upstream responses that do not match a pending client request", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "unmatched-response",
        result: {
          marker: "RAW_UNMATCHED_RESULT_MARKER"
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_UNMATCHED_RESULT_MARKER");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [
          {
            code: "jsonrpc.unmatched_response",
            reason: "upstream JSON-RPC response did not match a pending client request"
          }
        ]
      }
    });
  });

  it("drops client responses that do not match a pending upstream server request", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "unmatched-client-response",
        result: {
          marker: "RAW_CLIENT_RESPONSE_MARKER"
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_CLIENT_RESPONSE_MARKER");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [
          {
            code: "jsonrpc.unmatched_response",
            reason: "client JSON-RPC response did not match a pending upstream server request"
          }
        ]
      }
    });
  });

  it("drops unmatched upstream error responses after redacting sensitive error fields", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "unmatched-error",
        error: {
          code: -32000,
          message: "failed at workspace/hidden/secret.txt",
          data: {
            marker: "RAW_UNMATCHED_ERROR_DATA_MARKER"
          }
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(JSON.stringify(result.auditEvents)).not.toContain("workspace/hidden/secret.txt");
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_UNMATCHED_ERROR_DATA_MARKER");
    expect(result.auditEvents).toHaveLength(2);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      redaction: {
        applied: true,
        counts: {
          jsonrpc_error_data: 1,
          jsonrpc_error_message: 1
        }
      }
    });
    expect(result.auditEvents[1]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ code: "jsonrpc.unmatched_response" }]
      }
    });
  });

  it("denies duplicate pending client request ids without overwriting the original request", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const first = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "duplicate-client-id",
        method: "tools/list"
      })
    );
    expect(first.forwardLine).toBeTruthy();

    const duplicate = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "duplicate-client-id",
        method: "ping"
      })
    );

    expect(duplicate.forwardLine).toBeUndefined();
    expect(JSON.parse(duplicate.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: "duplicate-client-id",
      error: {
        code: -32001,
        message: "MCP request denied by proxy protocol state",
        data: {
          decision: {
            action: "deny",
            evidence: [
              {
                code: "jsonrpc.invalid",
                method: "ping",
                reason: "client JSON-RPC request id already has a pending upstream response"
              }
            ]
          }
        }
      }
    });
    expect(duplicate.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ code: "jsonrpc.invalid", method: "ping" }]
      }
    });

    const originalResponse = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "duplicate-client-id",
        result: readJsonFixture("fixtures/mcp/tools-list-basic.json")
      })
    );

    expect(JSON.parse(originalResponse.forwardLine ?? "{}")).toMatchObject({
      id: "duplicate-client-id",
      result: {
        tools: [{ name: "read_file" }]
      }
    });
  });

  it("drops upstream error responses with invalid error object fields", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "invalid-error-fields",
        error: {
          code: "not-a-number",
          message: "RAW_INVALID_ERROR_MESSAGE_MARKER"
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_INVALID_ERROR_MESSAGE_MARKER");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ reason: "JSON-RPC error must include numeric code and string message" }]
      }
    });
  });

  it("drops upstream error responses whose error member is not an object", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "invalid-error-member",
        error: "RAW_INVALID_ERROR_MEMBER_MARKER"
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_INVALID_ERROR_MEMBER_MARKER");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ reason: "JSON-RPC error must include numeric code and string message" }]
      }
    });
  });

  it("removes upstream JSON-RPC error data before forwarding", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "error-with-data",
        method: "ping"
      })
    );

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "error-with-data",
        error: {
          code: -32000,
          message: "upstream failure",
          data: {
            marker: "RAW_ERROR_DATA_MARKER",
            path: "workspace/private/secret.txt"
          }
        }
      })
    );

    const forwarded = JSON.parse(result.forwardLine ?? "{}") as {
      readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
    };
    expect(forwarded).toMatchObject({
      jsonrpc: "2.0",
      id: "error-with-data",
      error: {
        code: -32000,
        message: "upstream failure"
      }
    });
    expect(forwarded.error?.data).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_ERROR_DATA_MARKER");
    expect(JSON.stringify(result.auditEvents)).not.toContain("workspace/private/secret.txt");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ reason: "upstream JSON-RPC error data removed before forwarding" }]
      },
      redaction: {
        applied: true,
        counts: {
          jsonrpc_error_data: 1
        }
      }
    });
  });

  it("forwards benign upstream JSON-RPC error messages unchanged", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "benign-error-message",
        method: "ping"
      })
    );
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: "benign-error-message",
      error: {
        code: -32000,
        message: "upstream failure"
      }
    });

    const result = session.handleServerLine(line);

    expect(result.forwardLine).toBe(line);
    expect(result.responseLine).toBeUndefined();
    expect(result.auditEvents).toHaveLength(0);
  });

  it("redacts upstream JSON-RPC error messages that look path-sensitive", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "path-error-message",
        method: "ping"
      })
    );

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "path-error-message",
        error: {
          code: -32000,
          message: "failed to read workspace/hidden/secret.txt"
        }
      })
    );

    const forwarded = JSON.parse(result.forwardLine ?? "{}") as {
      readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
    };
    expect(forwarded).toMatchObject({
      jsonrpc: "2.0",
      id: "path-error-message",
      error: {
        code: -32000,
        message: "upstream error message redacted"
      }
    });
    expect(forwarded.error?.data).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(result.forwardLine).not.toContain("workspace/hidden/secret.txt");
    expect(JSON.stringify(result.auditEvents)).not.toContain("workspace/hidden/secret.txt");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ reason: "upstream JSON-RPC error message redacted before forwarding" }]
      },
      redaction: {
        applied: true,
        counts: {
          jsonrpc_error_message: 1
        }
      }
    });
  });

  it("redacts upstream JSON-RPC error messages that look secret-sensitive", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "marker-error-message",
        method: "ping"
      })
    );

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "marker-error-message",
        error: {
          code: -32000,
          message: "upstream leaked REDACT_ME_ERROR_VALUE_123"
        }
      })
    );

    const forwarded = JSON.parse(result.forwardLine ?? "{}") as {
      readonly error?: { readonly code?: number; readonly message?: string };
    };
    expect(forwarded.error?.message).toBe("upstream error message redacted");
    expect(result.forwardLine).not.toContain("REDACT_ME_ERROR_VALUE_123");
    expect(JSON.stringify(result.auditEvents)).not.toContain("REDACT_ME_ERROR_VALUE_123");
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      redaction: {
        applied: true,
        counts: {
          jsonrpc_error_message: 1
        }
      }
    });
  });

  it("redacts both upstream JSON-RPC error data and sensitive messages", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "error-with-data-and-sensitive-message",
        method: "ping"
      })
    );

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "error-with-data-and-sensitive-message",
        error: {
          code: -32000,
          message: "failed at workspace/hidden/secret.txt",
          data: {
            marker: "RAW_ERROR_DATA_AND_MESSAGE_MARKER"
          }
        }
      })
    );

    const forwarded = JSON.parse(result.forwardLine ?? "{}") as {
      readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
    };
    expect(forwarded).toMatchObject({
      jsonrpc: "2.0",
      id: "error-with-data-and-sensitive-message",
      error: {
        code: -32000,
        message: "upstream error message redacted"
      }
    });
    expect(forwarded.error?.data).toBeUndefined();
    expect(result.forwardLine).not.toContain("workspace/hidden/secret.txt");
    expect(JSON.stringify(result.auditEvents)).not.toContain("workspace/hidden/secret.txt");
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_ERROR_DATA_AND_MESSAGE_MARKER");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ reason: "upstream JSON-RPC error data removed and message redacted before forwarding" }]
      },
      redaction: {
        applied: true,
        counts: {
          jsonrpc_error_data: 1,
          jsonrpc_error_message: 1
        }
      }
    });
  });

  it("removes error data from failed tool discovery responses and clears visible tools", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    primeToolDiscovery(session);

    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-error",
        method: "tools/list"
      })
    );
    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-error",
        error: {
          code: -32001,
          message: "tool discovery failed",
          data: {
            marker: "RAW_DISCOVERY_ERROR_DATA_MARKER"
          }
        }
      })
    );

    const forwarded = JSON.parse(result.forwardLine ?? "{}") as {
      readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
    };
    expect(forwarded).toMatchObject({
      id: "tools-error",
      error: {
        code: -32001,
        message: "tool discovery failed"
      }
    });
    expect(forwarded.error?.data).toBeUndefined();
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_DISCOVERY_ERROR_DATA_MARKER");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      redaction: {
        applied: true,
        counts: {
          jsonrpc_error_data: 1
        }
      }
    });

    const call = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "call-after-discovery-error",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );

    expect(call.forwardLine).toBeUndefined();
    expect(JSON.parse(call.responseLine ?? "{}")).toMatchObject({
      id: "call-after-discovery-error",
      error: {
        data: {
          decision: {
            action: "deny",
            evidence: [{ reason: "tool was not visible in filtered discovery" }]
          }
        }
      }
    });
  });

  it("rejects client requests that include response fields", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "request-with-result",
        method: "tools/list",
        result: {}
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        data: {
          decision: {
            action: "deny",
            evidence: [{ reason: "JSON-RPC request or notification must not include result or error" }]
          }
        }
      }
    });
    expect(result.auditEvents).toHaveLength(1);
  });

  it("rejects client messages that exceed the configured frame byte limit", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local",
      maxFrameBytes: 32
    });

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "too-large",
        method: "ping"
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32600,
        data: {
          decision: {
            action: "deny",
            evidence: [{ code: "jsonrpc.frame_too_large" }]
          }
        }
      }
    });
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        evidence: [{ code: "jsonrpc.frame_too_large" }]
      }
    });
  });

  it("drops upstream messages that exceed the configured JSON depth limit", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local",
      maxJsonDepth: 3
    });

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "too-deep",
        result: {
          nested: {
            value: true
          }
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        evidence: [{ code: "jsonrpc.too_deep" }]
      }
    });
  });

  it("denies unsupported upstream server requests before response correlation", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "same-id",
        method: "tools/list"
      })
    );

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "same-id",
        method: "sampling/createMessage",
        params: {
          messages: []
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: "same-id",
      error: {
        code: -32001,
        data: {
          decision: {
            action: "deny",
            evidence: [{ method: "sampling/createMessage" }]
          }
        }
      }
    });
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "method-denied",
      method: "sampling/createMessage",
      decision: { action: "deny" }
    });

    const discovery = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "same-id",
        result: readJsonFixture("fixtures/mcp/tools-list-basic.json")
      })
    );

    expect(JSON.parse(discovery.forwardLine ?? "{}")).toMatchObject({
      id: "same-id",
      result: {
        tools: [
          {
            name: "read_file"
          }
        ]
      }
    });
  });

  it("denies client-only methods when they are initiated by the upstream server", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "server-call",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: "server-call",
      error: {
        code: -32001,
        data: {
          decision: {
            action: "deny",
            evidence: [{ method: "tools/call", reason: "MCP method is not allowed from upstream server" }]
          }
        }
      }
    });
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "method-denied",
      method: "tools/call",
      decision: { action: "deny" }
    });
  });

  it("forwards upstream server ping requests when the method policy allows ping", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: "server-ping",
      method: "ping"
    });

    const result = session.handleServerLine(line);

    expect(result.forwardLine).toBe(line);
    expect(result.responseLine).toBeUndefined();
    expect(result.auditEvents).toHaveLength(0);
  });

  it("forwards client responses only after a matching upstream server ping request", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    const pingLine = JSON.stringify({
      jsonrpc: "2.0",
      id: "server-ping-match",
      method: "ping"
    });
    const responseLine = JSON.stringify({
      jsonrpc: "2.0",
      id: "server-ping-match",
      result: {}
    });

    expect(session.handleServerLine(pingLine).forwardLine).toBe(pingLine);

    const result = session.handleClientLine(responseLine);

    expect(result.forwardLine).toBe(responseLine);
    expect(result.responseLine).toBeUndefined();
    expect(result.auditEvents).toHaveLength(0);
  });

  it("drops client ping responses that carry payload data", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    const pingLine = JSON.stringify({
      jsonrpc: "2.0",
      id: "server-ping-payload-response",
      method: "ping"
    });

    expect(session.handleServerLine(pingLine).forwardLine).toBe(pingLine);

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "server-ping-payload-response",
        result: {
          marker: "RAW_CLIENT_PING_RESPONSE_MARKER"
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_CLIENT_PING_RESPONSE_MARKER");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [
          {
            code: "jsonrpc.invalid",
            method: "ping",
            reason: "client response to server-origin ping must be an empty result"
          }
        ]
      }
    });
  });

  it("drops client ping error responses without forwarding raw error details", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    const pingLine = JSON.stringify({
      jsonrpc: "2.0",
      id: "server-ping-error-response",
      method: "ping"
    });

    expect(session.handleServerLine(pingLine).forwardLine).toBe(pingLine);

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "server-ping-error-response",
        error: {
          code: -32000,
          message: "RAW_CLIENT_PING_ERROR_MARKER"
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(result.responseLine).toBeUndefined();
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_CLIENT_PING_ERROR_MARKER");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ code: "jsonrpc.invalid", method: "ping" }]
      }
    });
  });

  it("denies duplicate pending upstream server request ids without overwriting the original request", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    const firstPing = JSON.stringify({
      jsonrpc: "2.0",
      id: "duplicate-server-id",
      method: "ping"
    });

    expect(session.handleServerLine(firstPing).forwardLine).toBe(firstPing);

    const duplicate = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "duplicate-server-id",
        method: "ping"
      })
    );

    expect(duplicate.forwardLine).toBeUndefined();
    expect(JSON.parse(duplicate.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: "duplicate-server-id",
      error: {
        code: -32001,
        message: "MCP request denied by proxy protocol state",
        data: {
          decision: {
            action: "deny",
            evidence: [
              {
                code: "jsonrpc.invalid",
                method: "ping",
                reason: "upstream server JSON-RPC request id already has a pending client response"
              }
            ]
          }
        }
      }
    });
    expect(duplicate.auditEvents[0]).toMatchObject({
      kind: "error",
      method: "ping",
      decision: {
        action: "deny",
        evidence: [{ code: "jsonrpc.invalid", method: "ping" }]
      }
    });

    const originalResponse = JSON.stringify({
      jsonrpc: "2.0",
      id: "duplicate-server-id",
      result: {}
    });

    expect(session.handleClientLine(originalResponse).forwardLine).toBe(originalResponse);
  });

  it("forwards upstream server ping requests with empty params only", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: "server-ping-empty",
      method: "ping",
      params: {}
    });

    const result = session.handleServerLine(line);

    expect(result.forwardLine).toBe(line);
    expect(result.responseLine).toBeUndefined();
    expect(result.auditEvents).toHaveLength(0);
  });

  it("denies upstream server ping requests that carry params", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "server-ping-payload",
        method: "ping",
        params: {
          marker: "RAW_PING_PAYLOAD_MARKER"
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: "server-ping-payload",
      error: {
        code: -32001,
        data: {
          decision: {
            action: "deny",
            evidence: [{ method: "ping", reason: "server-origin ping must not carry params" }]
          }
        }
      }
    });
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_PING_PAYLOAD_MARKER");
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "method-denied",
      method: "ping",
      decision: { action: "deny" }
    });
  });

  it("denies upstream server ping requests with non-object params", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "server-ping-array",
        method: "ping",
        params: []
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: "server-ping-array",
      error: {
        code: -32001,
        data: {
          decision: {
            action: "deny",
            evidence: [{ method: "ping", reason: "server-origin ping must not carry params" }]
          }
        }
      }
    });
    expect(result.auditEvents).toHaveLength(1);
  });

  it("denies unsupported client methods without forwarding upstream", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/list",
        params: {}
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32001,
        data: {
          decision: {
            action: "deny",
            evidence: [{ method: "resources/list" }]
          }
        }
      }
    });
    expect(result.auditEvents).toHaveLength(1);
    expect(result.auditEvents[0]).toMatchObject({
      kind: "method-denied",
      profileId: "local",
      method: "resources/list",
      decision: { action: "deny" }
    });
  });

  it("filters tool discovery and remembers visible tool capabilities", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const outbound = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-1",
        method: "tools/list"
      })
    );
    expect(outbound.forwardLine).toBeTruthy();

    const inbound = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-1",
        result: readJsonFixture("fixtures/mcp/tools-list-basic.json")
      })
    );

    const filtered = JSON.parse(inbound.forwardLine ?? "{}") as { readonly result?: { readonly tools?: readonly { readonly name: string }[] } };
    expect(filtered.result?.tools?.map((tool) => tool.name)).toEqual(["read_file"]);
    expect(inbound.auditEvents).toHaveLength(1);
    expect(inbound.auditEvents[0]).toMatchObject({
      kind: "discovery-filtered",
      decision: { action: "deny" }
    });
  });

  it("removes non-contract top-level fields from visible tool discovery descriptors", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-sanitize",
        method: "tools/list"
      })
    );

    const inbound = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-sanitize",
        result: {
          tools: [
            {
              name: "read_file",
              description: "Read a file from a caller-provided path.",
              inputSchema: {
                type: "object",
                properties: {
                  path: { type: "string" }
                }
              },
              outputSchema: {
                type: "object"
              },
              annotations: {
                readOnlyHint: true
              },
              _meta: {
                debug: "RAW_VISIBLE_DESCRIPTOR_META_MARKER"
              },
              debug: "RAW_VISIBLE_DESCRIPTOR_DEBUG_MARKER"
            },
            {
              name: "unknown_tool",
              description: "Do something vaguely useful.",
              debug: "RAW_HIDDEN_DESCRIPTOR_DEBUG_MARKER"
            }
          ]
        }
      })
    );

    const forwarded = JSON.parse(inbound.forwardLine ?? "{}") as {
      readonly result?: { readonly tools?: readonly Record<string, unknown>[] };
    };
    expect(forwarded.result?.tools).toEqual([
      {
        name: "read_file",
        description: "Read a file from a caller-provided path.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" }
          }
        },
        outputSchema: {
          type: "object"
        },
        annotations: {
          readOnlyHint: true
        }
      }
    ]);
    expect(JSON.stringify(forwarded)).not.toContain("RAW_VISIBLE_DESCRIPTOR_META_MARKER");
    expect(JSON.stringify(forwarded)).not.toContain("RAW_VISIBLE_DESCRIPTOR_DEBUG_MARKER");
    expect(JSON.stringify(forwarded)).not.toContain("RAW_HIDDEN_DESCRIPTOR_DEBUG_MARKER");
    expect(JSON.stringify(inbound.auditEvents)).not.toContain("RAW_VISIBLE_DESCRIPTOR_META_MARKER");
    expect(JSON.stringify(inbound.auditEvents)).not.toContain("RAW_HIDDEN_DESCRIPTOR_DEBUG_MARKER");
  });

  it("denies tool calls whose extracted path facts violate policy", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    primeToolDiscovery(session);

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/private/secret.txt"
          }
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      id: 2,
      error: {
        data: {
          decision: {
            action: "deny",
            evidence: [{ ruleId: "deny-private-files" }]
          }
        }
      }
    });
    expect(result.auditEvents[0]).toMatchObject({
      kind: "call-decision",
      toolName: "read_file",
      decision: { action: "deny" }
    });
  });

  it("does not treat denied tool calls as pending upstream requests", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    primeToolDiscovery(session);

    const denied = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "denied-call-id",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/private/secret.txt"
          }
        }
      })
    );
    expect(denied.forwardLine).toBeUndefined();
    expect(JSON.parse(denied.responseLine ?? "{}")).toMatchObject({
      id: "denied-call-id",
      error: {
        data: {
          decision: {
            action: "deny",
            evidence: [{ ruleId: "deny-private-files" }]
          }
        }
      }
    });

    const forgedUpstreamResponse = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "denied-call-id",
        result: {
          marker: "RAW_DENIED_CALL_RESPONSE_MARKER"
        }
      })
    );

    expect(forgedUpstreamResponse.forwardLine).toBeUndefined();
    expect(forgedUpstreamResponse.responseLine).toBeUndefined();
    expect(JSON.stringify(forgedUpstreamResponse.auditEvents)).not.toContain("RAW_DENIED_CALL_RESPONSE_MARKER");
    expect(forgedUpstreamResponse.auditEvents).toHaveLength(1);
    expect(forgedUpstreamResponse.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        action: "deny",
        evidence: [{ code: "jsonrpc.unmatched_response" }]
      }
    });
  });

  it("denies tool calls before the tool is visible in filtered discovery", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      id: 3,
      error: {
        data: {
          decision: {
            action: "deny",
            evidence: [{ reason: "tool was not visible in filtered discovery" }]
          }
        }
      }
    });
    expect(result.auditEvents[0]).toMatchObject({
      kind: "call-decision",
      toolName: "read_file",
      decision: { action: "deny" }
    });
  });

  it("denies calls to tools hidden by discovery filtering", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    primeToolDiscovery(session);

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "unknown_tool",
          arguments: {}
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      id: 4,
      error: {
        data: {
          decision: {
            action: "deny",
            evidence: [{ reason: "tool was not visible in filtered discovery" }]
          }
        }
      }
    });
    expect(result.auditEvents[0]).toMatchObject({
      kind: "call-decision",
      toolName: "unknown_tool",
      decision: { action: "deny" }
    });
  });

  it("replaces visible tool state on each filtered discovery response", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    primeToolDiscovery(session);

    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-2",
        method: "tools/list"
      })
    );
    const refreshed = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "tools-2",
        result: {
          tools: [
            {
              name: "unknown_tool",
              description: "Do something vaguely useful."
            }
          ]
        }
      })
    );

    expect(JSON.parse(refreshed.forwardLine ?? "{}")).toMatchObject({
      id: "tools-2",
      result: {
        tools: []
      }
    });

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      id: 5,
      error: {
        data: {
          decision: {
            action: "deny",
            evidence: [{ reason: "tool was not visible in filtered discovery" }]
          }
        }
      }
    });
  });

  it("preserves JSON-RPC id type when matching pending discovery responses", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });

    session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "tools/list"
      })
    );

    const numericIdResponse = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: readJsonFixture("fixtures/mcp/tools-list-basic.json")
      })
    );

    expect(numericIdResponse.forwardLine).toBeUndefined();
    expect(numericIdResponse.responseLine).toBeUndefined();
    expect(numericIdResponse.auditEvents).toHaveLength(1);
    expect(numericIdResponse.auditEvents[0]).toMatchObject({
      kind: "error",
      decision: {
        evidence: [{ code: "jsonrpc.unmatched_response" }]
      }
    });

    const deniedBeforeMatchingDiscovery = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "call-before",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );

    expect(deniedBeforeMatchingDiscovery.forwardLine).toBeUndefined();
    expect(JSON.parse(deniedBeforeMatchingDiscovery.responseLine ?? "{}")).toMatchObject({
      id: "call-before",
      error: {
        data: {
          decision: {
            action: "deny",
            evidence: [{ reason: "tool was not visible in filtered discovery" }]
          }
        }
      }
    });

    const stringIdResponse = session.handleServerLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        result: readJsonFixture("fixtures/mcp/tools-list-basic.json")
      })
    );

    expect(JSON.parse(stringIdResponse.forwardLine ?? "{}")).toMatchObject({
      id: "1",
      result: {
        tools: [
          {
            name: "read_file"
          }
        ]
      }
    });
    expect(stringIdResponse.auditEvents).toHaveLength(1);

    const allowedAfterMatchingDiscovery = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "call-after",
        method: "tools/call",
        params: {
          name: "read_file",
          arguments: {
            path: "workspace/public/readme.md"
          }
        }
      })
    );

    expect(allowedAfterMatchingDiscovery.forwardLine).toBeTruthy();
    expect(allowedAfterMatchingDiscovery.responseLine).toBeUndefined();
  });

  it("forwards allowed tool calls after policy evaluation", () => {
    const session = createProxySession({
      policy: readPolicy(),
      profileId: "local"
    });
    primeToolDiscovery(session);

    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "read_file",
        arguments: {
          path: "workspace/public/readme.md"
        }
      }
    });
    const result = session.handleClientLine(line);

    expect(result.forwardLine).toBe(line);
    expect(result.responseLine).toBeUndefined();
    expect(result.auditEvents[0]).toMatchObject({
      kind: "call-decision",
      toolName: "read_file",
      decision: {
        action: "allow",
        evidence: [{ ruleId: "allow-public-files" }]
      }
    });
  });

  it("denies approval-required calls in the sync runtime path without an approval hook", () => {
    const session = createProxySession({
      policy: readApprovalPolicy(),
      profileId: "local",
      approvalHookAvailable: true
    });
    primeShellDiscovery(session);

    const result = session.handleClientLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "approval-sync",
        method: "tools/call",
        params: {
          name: "run_command",
          arguments: {}
        }
      })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: "approval-sync",
      error: {
        code: -32001,
        data: {
          decision: {
            action: "deny",
            evidence: [
              {
                code: "policy.approval_hook_missing",
                ruleId: "approval-shell"
              }
            ]
          }
        }
      }
    });
    expect(result.auditEvents[0]).toMatchObject({
      kind: "call-decision",
      toolName: "run_command",
      decision: {
        action: "deny",
        evidence: [{ code: "policy.approval_hook_missing", ruleId: "approval-shell" }]
      }
    });
  });

  it("forwards approval-required calls when the runtime approval hook approves them", async () => {
    const session = createProxySession({
      policy: readApprovalPolicy(),
      profileId: "local"
    });
    primeShellDiscovery(session);
    const line = JSON.stringify({
      jsonrpc: "2.0",
      id: "approval-async",
      method: "tools/call",
      params: {
        name: "run_command",
        arguments: {}
      }
    });

    const result = await session.handleClientLineWithApproval(line, async (request) => {
      expect(request.call).toMatchObject({
        toolName: "run_command",
        capabilities: ["shell"],
        argumentFacts: []
      });
      expect(request.decision).toMatchObject({
        action: "approval_required",
        evidence: [{ ruleId: "approval-shell" }]
      });
      return { approved: true };
    });

    expect(result.forwardLine).toBe(line);
    expect(result.responseLine).toBeUndefined();
    expect(result.auditEvents[0]).toMatchObject({
      kind: "call-decision",
      toolName: "run_command",
      decision: {
        action: "approval_required",
        evidence: [{ ruleId: "approval-shell" }]
      }
    });
  });

  it("denies approval-required calls when the runtime approval hook rejects them", async () => {
    const session = createProxySession({
      policy: readApprovalPolicy(),
      profileId: "local"
    });
    primeShellDiscovery(session);

    const result = await session.handleClientLineWithApproval(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "approval-denied",
        method: "tools/call",
        params: {
          name: "run_command",
          arguments: {}
        }
      }),
      () => ({ approved: false, reason: "approval denied by test hook" })
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: "approval-denied",
      error: {
        code: -32001,
        data: {
          decision: {
            action: "deny",
            evidence: [
              {
                code: "policy.approval_denied",
                ruleId: "approval-shell",
                reason: "approval denied by test hook"
              }
            ]
          }
        }
      }
    });
    expect(result.auditEvents[0]).toMatchObject({
      kind: "call-decision",
      toolName: "run_command",
      decision: {
        action: "deny",
        evidence: [{ code: "policy.approval_denied", ruleId: "approval-shell" }]
      }
    });
  });

  it("fails closed per call when the runtime approval hook throws", async () => {
    const session = createProxySession({
      policy: readApprovalPolicy(),
      profileId: "local"
    });
    primeShellDiscovery(session);

    const result = await session.handleClientLineWithApproval(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "approval-hook-error",
        method: "tools/call",
        params: {
          name: "run_command",
          arguments: {}
        }
      }),
      () => {
        throw new Error("RAW_APPROVAL_HOOK_FAILURE_MARKER");
      }
    );

    expect(result.forwardLine).toBeUndefined();
    expect(JSON.stringify(result.auditEvents)).not.toContain("RAW_APPROVAL_HOOK_FAILURE_MARKER");
    expect(JSON.parse(result.responseLine ?? "{}")).toMatchObject({
      jsonrpc: "2.0",
      id: "approval-hook-error",
      error: {
        code: -32001,
        data: {
          decision: {
            action: "deny",
            evidence: [
              {
                code: "policy.approval_hook_failed",
                ruleId: "approval-shell",
                reason: "approval hook failed closed"
              }
            ]
          }
        }
      }
    });
    expect(result.auditEvents[0]).toMatchObject({
      kind: "call-decision",
      toolName: "run_command",
      decision: {
        action: "deny",
        evidence: [{ code: "policy.approval_hook_failed", ruleId: "approval-shell" }]
      }
    });
  });
});

function primeToolDiscovery(session: ReturnType<typeof createProxySession>): void {
  session.handleClientLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "tools-1",
      method: "tools/list"
    })
  );
  session.handleServerLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "tools-1",
      result: readJsonFixture("fixtures/mcp/tools-list-basic.json")
    })
  );
}

function primeShellDiscovery(session: ReturnType<typeof createProxySession>): void {
  session.handleClientLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "shell-tools",
      method: "tools/list"
    })
  );
  session.handleServerLine(
    JSON.stringify({
      jsonrpc: "2.0",
      id: "shell-tools",
      result: {
        tools: [
          {
            name: "run_command",
            description: "Run a shell command."
          }
        ]
      }
    })
  );
}

function readPolicy(): PolicyDocument {
  return readJsonFixture<PolicyDocument>("fixtures/policies/local-dev.json");
}

function readApprovalPolicy(): PolicyDocument {
  const policy = readPolicy();
  return {
    ...policy,
    profiles: policy.profiles.map((profile) =>
      profile.id === "local"
        ? {
            ...profile,
            rules: [
              {
                id: "approval-shell",
                action: "approval_required",
                capabilities: ["shell"]
              }
            ]
          }
        : profile
    )
  };
}

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8")) as T;
}
