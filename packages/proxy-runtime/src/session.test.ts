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

    const unfiltered = JSON.parse(numericIdResponse.forwardLine ?? "{}") as {
      readonly id?: string | number;
      readonly result?: { readonly tools?: readonly { readonly name: string }[] };
    };
    expect(unfiltered.id).toBe(1);
    expect(unfiltered.result?.tools?.map((tool) => tool.name)).toEqual(["read_file", "run_command", "unknown_tool"]);
    expect(numericIdResponse.auditEvents).toHaveLength(0);

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

function readPolicy(): PolicyDocument {
  return readJsonFixture<PolicyDocument>("fixtures/policies/local-dev.json");
}

function readJsonFixture<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, path), "utf8")) as T;
}
