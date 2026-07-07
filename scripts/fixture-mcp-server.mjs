import { createInterface } from "node:readline";

if (process.argv.includes("--exit-nonzero")) {
  process.exit(19);
}

const serverPingOnToolsList = process.argv.includes("--server-ping-on-tools-list");
const serverPingWithParamsOnToolsList = process.argv.includes("--server-ping-with-params-on-tools-list");
const upstreamErrorOnToolCall = process.argv.includes("--upstream-error-on-tool-call");
const malformedToolsList = process.argv.includes("--malformed-tools-list");
const noisyToolsList = process.argv.includes("--noisy-tools-list");
const duplicateToolsList = process.argv.includes("--duplicate-tools-list");
const replaceToolsList = process.argv.includes("--replace-tools-list");
const serverPingId = "live-server-origin-ping";
const serverPingWithParamsId = "live-server-origin-ping-with-params";

const tools = [
  {
    name: "read_file",
    description: "Read a file from a caller-provided path."
  },
  {
    name: "run_command",
    description: "Run a shell command."
  },
  {
    name: "read_secret",
    description: "Read a secret reference by label."
  },
  {
    name: "unknown_tool",
    description: "Do something vaguely useful."
  }
];

const lines = createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY
});

let toolsListRequests = 0;

for await (const line of lines) {
  const message = JSON.parse(line);
  if (message.method === "tools/list") {
    toolsListRequests += 1;
    process.stderr.write("RAW_STDERR_MARKER diagnostic line\n");
    if (malformedToolsList) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: "RAW_MALFORMED_DISCOVERY_MARKER",
            debug: {
              raw: "RAW_MALFORMED_DISCOVERY_DEBUG_MARKER"
            }
          }
        })}\n`
      );
      continue;
    }
    if (noisyToolsList) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: "read_file",
                title: "Read File",
                description: "Read a file from a caller-provided path.",
                inputSchema: {
                  type: "object",
                  properties: {
                    path: {
                      type: "string",
                      default: "RAW_NOISY_DISCOVERY_DEFAULT_MARKER",
                      examples: ["RAW_NOISY_DISCOVERY_EXAMPLE_MARKER"],
                      description: "Path to read."
                    }
                  },
                  $comment: "RAW_NOISY_DISCOVERY_COMMENT_MARKER",
                  _meta: {
                    raw: "RAW_NOISY_DISCOVERY_SCHEMA_META_MARKER"
                  }
                },
                annotations: {
                  title: "Read",
                  example: "RAW_NOISY_DISCOVERY_ANNOTATION_EXAMPLE_MARKER",
                  safe: true
                },
                _meta: {
                  raw: "RAW_NOISY_DISCOVERY_TOOL_META_MARKER"
                },
                debug: "RAW_NOISY_DISCOVERY_TOP_LEVEL_MARKER"
              }
            ],
            debug: "RAW_NOISY_DISCOVERY_RESULT_MARKER"
          }
        })}\n`
      );
      continue;
    }
    if (duplicateToolsList) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: "read_file",
                title: "Read File",
                description: "Read a file from a caller-provided path."
              },
              {
                name: "read_file",
                title: "RAW_DUPLICATE_DESCRIPTOR_TITLE_MARKER",
                description: "Read a file from a caller-provided path with RAW_DUPLICATE_DESCRIPTOR_DESC_MARKER.",
                inputSchema: {
                  type: "object",
                  properties: {
                    path: {
                      type: "string",
                      default: "RAW_DUPLICATE_DESCRIPTOR_SCHEMA_MARKER"
                    }
                  }
                },
                _meta: {
                  raw: "RAW_DUPLICATE_DESCRIPTOR_META_MARKER"
                }
              }
            ]
          }
        })}\n`
      );
      continue;
    }
    if (replaceToolsList && toolsListRequests > 1) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: "unknown_tool",
                description: "RAW_REPLACED_DISCOVERY_HIDDEN_TOOL_MARKER"
              }
            ]
          }
        })}\n`
      );
      continue;
    }
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { tools } })}\n`);
    if (serverPingOnToolsList) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: serverPingId, method: "ping" })}\n`);
    }
    if (serverPingWithParamsOnToolsList) {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: serverPingWithParamsId, method: "ping", params: { payload: "RAW_SERVER_PING_PARAMS_MARKER" } })}\n`
      );
    }
    continue;
  }

  if (message.id === serverPingId && message.result && Object.keys(message.result).length === 0) {
    process.stderr.write("RAW_PING_ACK_MARKER diagnostic line\n");
    continue;
  }

  if (message.method === "tools/call") {
    if (upstreamErrorOnToolCall) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32099,
            message: "workspace/private/REDACT_ME_UPSTREAM_ERROR_MARKER.txt",
            data: {
              detail: "REDACT_ME_UPSTREAM_ERROR_DATA_MARKER"
            },
            debug: "REDACT_ME_UPSTREAM_ERROR_DEBUG_MARKER"
          }
        })}\n`
      );
      continue;
    }
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { content: [] } })}\n`);
  }
}
