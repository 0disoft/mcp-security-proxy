import type {
  NormalizedToolCall,
  NormalizedToolDescriptor
} from "@0disoft/mcp-security-proxy-contracts";

export function createFileReadToolDescriptor(): NormalizedToolDescriptor {
  return {
    name: "read_file",
    description: "Read a file path provided by the caller.",
    capabilities: ["file-read"]
  };
}

export function createDeniedFileReadCall(): NormalizedToolCall {
  return {
    method: "tools/call",
    toolName: "read_file",
    capabilities: ["file-read"],
    argumentFacts: [{ kind: "path", value: "workspace/private-notes.md" }]
  };
}
