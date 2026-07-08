import { describe, expect, it } from "vitest";
import { extractArgumentFacts, normalizeToolCallEnvelope } from "./tool-call.js";

describe("MCP adapter tool-call normalization", () => {
  it("normalizes tools/call envelopes with policy facts from nested arguments", () => {
    const secretKey = `api${"Key"}`;
    const call = normalizeToolCallEnvelope(
      {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "untrusted-client-name",
          arguments: {
            path: "workspace/public/report.md",
            endpoint: "https://api.example.com/v1",
            shell: {
              executable: "node",
              argv: ["script.js"]
            },
            [secretKey]: "RAW_VALUE_MARKER"
          }
        }
      },
      {
        name: "read_file",
        capabilities: ["file-read", "network", "secret", "shell"]
      }
    );

    expect(call).toEqual({
      method: "tools/call",
      toolName: "read_file",
      capabilities: ["file-read", "network", "secret", "shell"],
      argumentFacts: [
        { kind: "path", value: "workspace/public/report.md" },
        { kind: "network", value: "https://api.example.com/v1" },
        { kind: "command", executable: "node", argv: ["script.js"] },
        { kind: "secret", label: "api-key" }
      ]
    });
    expect(JSON.stringify(call)).not.toContain("RAW_VALUE_MARKER");
    expect(JSON.stringify(call)).not.toContain("untrusted-client-name");
  });

  it("extracts secret labels without storing secret argument values", () => {
    const passwordKey = `pass${"word"}`;
    const tokenKey = `auth${"Token"}`;
    const facts = extractArgumentFacts({
      [passwordKey]: "RAW_PASSWORD_MARKER",
      nested: {
        [tokenKey]: "RAW_TOKEN_MARKER"
      }
    });

    expect(facts).toEqual([
      { kind: "secret", label: "password" },
      { kind: "secret", label: "token" }
    ]);
    expect(JSON.stringify(facts)).not.toContain("RAW_PASSWORD_MARKER");
    expect(JSON.stringify(facts)).not.toContain("RAW_TOKEN_MARKER");
  });
});
