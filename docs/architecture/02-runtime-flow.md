# Runtime Flow

Status: Draft

## Startup Flow

1. CLI receives a profile name, policy path, server command or endpoint, and audit output path.
2. Policy file is parsed and validated.
3. Proxy starts the upstream MCP server or connects to it.
4. Proxy initializes MCP session negotiation through the supported method policy.
5. Proxy prepares audit redaction and decision logging.

## Method Policy Flow

1. Proxy receives an MCP message.
2. The runtime parses one newline-delimited JSON-RPC message at a time.
3. Proxy checks the method against the supported MVP method set.
4. Supported methods continue to method-specific handling.
5. Unsupported methods return an MCP-compatible denial and are not forwarded upstream.
6. Proxy records a redacted method-denial audit event.

## Runtime Message Gate

The implemented runtime gate accepts one client or upstream server JSON-RPC line, then returns the
line to forward, a denial response line, and redacted audit events. The CLI `run` command now wraps
this gate with a stdio subprocess bridge.

Current implemented responsibilities:

- deny unsupported client methods before upstream forwarding
- deny unsupported upstream server-origin methods before response correlation
- allow only payload-free server-origin `ping` in the current direction policy
- track `tools/list` request IDs so discovery responses can be filtered
- require upstream responses to match a pending client request id before forwarding
- classify discovered tools and hide tools without allow or approval coverage
- evaluate `tools/call` requests using remembered tool capabilities and extracted argument facts
- reject oversized JSON-RPC frames and overly deep parsed JSON messages
- remove upstream JSON-RPC `error.data` and redact sensitive-looking upstream error messages
- avoid raw tool arguments in audit events
- include stable decision evidence codes in audit decisions
- start one upstream stdio process from the CLI command after `--`
- keep stdout reserved for MCP protocol messages
- append audit events to the file selected by `--audit-log`
- summarize upstream stderr as redacted audit metadata without storing raw stderr lines
- map non-zero upstream exits to the CLI upstream-failure exit code and record a redacted audit event
- after client input closes, end upstream stdin and kill the upstream process if it does not exit
  within a bounded grace window
- after upstream stdout closes, kill the upstream process if it does not exit within the same
  bounded grace window
- allow the CLI `run` command to configure the shutdown grace window with
  `--shutdown-grace-ms`, defaulting to 1000 ms
- allow the CLI `run` command to configure frame guards with `--max-frame-bytes`, defaulting to
  1048576 bytes, and `--max-json-depth`, defaulting to 64

Retry policy, richer upstream stderr policy controls, broader lifecycle policy, and non-stdio
transports remain future runtime responsibilities.

## Tool Discovery Flow

1. Upstream server returns tool descriptors.
2. Proxy classifies tool capabilities from explicit policy, tool name, description, and schema.
3. Proxy applies discovery filtering rules.
4. Client receives only tools allowed for discovery.
5. Proxy records a redacted discovery audit event.

## Tool Call Flow

1. Client sends a tool call.
2. Proxy normalizes policy inputs such as path, command, domain, and argument metadata.
3. Proxy evaluates method policy, deny rules, approval rules, allow rules, then default deny.
4. If denied, proxy returns an MCP-compatible error and does not forward the call.
5. If approval is required and no host approval hook exists, proxy denies the call.
6. If allowed, proxy forwards the call to the upstream server.
7. Proxy redacts and writes the decision audit event.

## Failure Flow

- Invalid policy: startup fails with configuration error.
- Unclassified risky capability: call is denied by default.
- Unsupported method: request is denied by default and is not passed through.
- Unmatched upstream response: response is dropped with a redacted audit event.
- Oversized or overly deep JSON-RPC message: message is denied or dropped before forwarding.
- Upstream error response with data or sensitive message: error is sanitized before forwarding.
- Audit write failure: fail closed by default; policy may explicitly choose warn-and-continue.
- Upstream server crash: proxy exits with the upstream-failure CLI code and records a redacted error
  audit event without converting the crash into policy success.
- Upstream shutdown hang: proxy kills the process after the shutdown grace window and records a
  redacted upstream-failure audit event.
- Upstream stdout close without process exit: proxy kills the process after the shutdown grace
  window and records a redacted upstream-failure audit event.
