import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });

for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "mcp-security-proxy-agent-plugin-demo", version: "0.2.0-alpha.5" }
    });
    continue;
  }
  if (message.method === "ping") {
    respond(message.id, {});
    continue;
  }
  if (message.method === "tools/list") {
    respond(message.id, {
      tools: [
        {
          name: "demo_status",
          description: "Return a fixed status message without reading files, network, environment, or arguments.",
          inputSchema: { type: "object", additionalProperties: false }
        }
      ]
    });
    continue;
  }
  if (message.method === "tools/call") {
    if (message.params?.name === "demo_status") {
      respond(message.id, { content: [{ type: "text", text: "MCP Security Proxy demo is running." }] });
    } else {
      fail(message.id, -32601, "Unknown demo tool");
    }
  }
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}
