import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

if (process.argv.includes("--exit-nonzero")) {
  process.exit(19);
}

const serverPingOnToolsList = process.argv.includes("--server-ping-on-tools-list");
const serverPingWithParamsOnToolsList = process.argv.includes("--server-ping-with-params-on-tools-list");
const upstreamErrorOnToolCall = process.argv.includes("--upstream-error-on-tool-call");
const invalidResponseOnToolCall = process.argv.includes("--invalid-response-on-tool-call");
const malformedToolsList = process.argv.includes("--malformed-tools-list");
const noisyToolsList = process.argv.includes("--noisy-tools-list");
const duplicateToolsList = process.argv.includes("--duplicate-tools-list");
const replaceToolsList = process.argv.includes("--replace-tools-list");
const tooDeepToolsList = process.argv.includes("--too-deep-tools-list");
const requireInitialized = process.argv.includes("--require-initialized");
const rejectRequestExtraFields = process.argv.includes("--reject-request-extra-fields");
const responseExtraFields = process.argv.includes("--response-extra-fields");
const unmatchedResponseOnToolsList = process.argv.includes("--unmatched-response-on-tools-list");
const descendantModeIndex = process.argv.indexOf("--spawn-descendant-and-hang");
const descendantPidPath = descendantModeIndex >= 0 ? process.argv[descendantModeIndex + 1] : undefined;
if (descendantModeIndex >= 0) {
  if (!descendantPidPath) {
    throw new Error("--spawn-descendant-and-hang requires a PID output path");
  }
  const descendant = spawn(process.execPath, ["-e", "setInterval(() => undefined, 1000)"], {
    stdio: "ignore",
    windowsHide: true
  });
  if (!descendant.pid) {
    throw new Error("failed to start descendant fixture process");
  }
  writeFileSync(descendantPidPath, String(descendant.pid), "utf8");
}
const serverPingId = "live-server-origin-ping";
const serverPingWithParamsId = "live-server-origin-ping-with-params";
const requestEnvelopeKeys = new Set(["jsonrpc", "id", "method", "params"]);

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
let initialized = false;

for await (const line of lines) {
  const message = JSON.parse(line);
  if (rejectRequestExtraFields && typeof message.method === "string" && hasRequestExtraFields(message)) {
    process.stderr.write("RAW_REQUEST_EXTRA_FIELD_MARKER diagnostic line\n");
    if (message.id !== undefined) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32098,
            message: "RAW_REQUEST_EXTRA_FIELD_MARKER reached fixture server"
          }
        })}\n`
      );
    }
    continue;
  }

  if (message.method === "initialize") {
    writeResponse(
      {
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "fixture-protocol-version",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "fixture-mcp-server",
            version: "0.0.0"
          }
        }
      },
      "RAW_RESPONSE_EXTRA_FIELD_MARKER_INITIALIZE"
    );
    continue;
  }

  if (message.method === "notifications/initialized") {
    initialized = true;
    continue;
  }

  if (message.method === "tools/list") {
    toolsListRequests += 1;
    process.stderr.write("RAW_STDERR_MARKER diagnostic line\n");
    if (requireInitialized && !initialized) {
      writeResponse(
        {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: []
          }
        },
        "RAW_RESPONSE_EXTRA_FIELD_MARKER_PRE_INITIALIZED_TOOLS"
      );
      continue;
    }
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
    if (tooDeepToolsList) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            nested: {
              deeper: {
                deepest: "RAW_TOO_DEEP_DISCOVERY_MARKER"
              }
            }
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
    writeResponse({ jsonrpc: "2.0", id: message.id, result: { tools } }, "RAW_RESPONSE_EXTRA_FIELD_MARKER_TOOLS");
    if (unmatchedResponseOnToolsList) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: "live-unmatched-upstream-response",
          result: {
            marker: "RAW_UNMATCHED_RESPONSE_MARKER"
          }
        })}\n`
      );
    }
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

  if (message.id === serverPingId && message.result?.marker === "RAW_CLIENT_PING_RESPONSE_MARKER") {
    process.stderr.write("RAW_BAD_PING_RESPONSE_FORWARD_MARKER diagnostic line\n");
    continue;
  }

  if (message.method === "tools/call") {
    if (invalidResponseOnToolCall) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            marker: "RAW_INVALID_RESPONSE_RESULT_MARKER"
          },
          error: {
            code: -32097,
            message: "RAW_INVALID_RESPONSE_ERROR_MARKER"
          }
        })}\n`
      );
      continue;
    }
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

if (descendantModeIndex >= 0) {
  await new Promise(() => undefined);
}

function hasRequestExtraFields(message) {
  return Object.keys(message).some((key) => !requestEnvelopeKeys.has(key));
}

function writeResponse(envelope, marker) {
  process.stdout.write(
    `${JSON.stringify(
      responseExtraFields
        ? {
            ...envelope,
            trace: {
              marker
            }
          }
        : envelope
    )}\n`
  );
}
