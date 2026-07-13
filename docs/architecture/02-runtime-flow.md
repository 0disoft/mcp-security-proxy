# Runtime Flow

Status: Draft

## Startup Flow

1. CLI receives a profile name, policy path, server command or endpoint, and optional audit path
   override.
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
- enforce request-vs-notification JSON-RPC id shape for supported MCP methods
- allow only payload-free server-origin `ping` in the current direction policy
- rebuild forwarded JSON-RPC request envelopes with only `jsonrpc`, `method`, optional `id`, and
  optional `params`
- track `tools/list` request IDs so discovery responses can be filtered
- reject concurrent `tools/list` requests while a discovery response is still pending
- require upstream responses to match a pending client request id before forwarding
- bound pending client and server-origin request state with a maximum in-flight count and TTL
- rebuild forwarded JSON-RPC response envelopes with only `jsonrpc`, `id`, and exactly one of
  `result` or `error`
- classify discovered tools and hide tools without allow or approval coverage
- rebuild visible discovery descriptors with only the MVP-forwarded descriptor fields
- evaluate `tools/call` requests using remembered tool capabilities and extracted argument facts
- call an embedding host approval hook before forwarding approval-required tool calls
- deny approval-required tool calls when no runtime approval hook is available
- reject oversized JSON-RPC frames at the stdio transport boundary before waiting for a newline
  delimiter, then reject overly deep parsed JSON messages after parsing
- remove upstream JSON-RPC error data and extra fields, and redact sensitive-looking upstream error
  messages
- avoid raw tool arguments in audit events
- include stable decision evidence codes in audit decisions
- start one upstream stdio process from the CLI command after `--`
- keep stdout reserved for MCP protocol messages
- append audit events to the selected profile audit file or the explicit `--audit-log` override
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
- wait for protocol writes to flush and fail closed when output streams error or close before a
  write completes

Retry policy, richer upstream stderr policy controls, broader lifecycle policy, and non-stdio
transports remain future runtime responsibilities.

## Tool Discovery Flow

1. Upstream server returns tool descriptors.
2. Proxy accepts only one pending `tools/list` request at a time, so discovery state is updated in
   request/response order instead of by whichever upstream response arrives last.
3. Proxy classifies tool capabilities from explicit policy, tool name, and description.
4. Proxy applies discovery filtering rules.
5. Proxy rebuilds each visible descriptor with only `name`, optional `title`, optional `description`,
   object-valued `inputSchema`, object-valued `outputSchema`, and object-valued `annotations`,
   while removing nested `default`, `example`, `examples`, `$comment`, and `_meta` metadata.
6. Proxy hides every descriptor for duplicate visible tool names.
7. Proxy rebuilds the `tools/list` success result with only `tools` and optional string
   `nextCursor`.
8. Malformed discovery success results are normalized to an empty `tools` array.
9. Client receives only sanitized tools allowed for discovery.
10. Proxy records a redacted discovery audit event.

## Tool Call Flow

1. Client sends a tool call.
2. Proxy normalizes policy inputs such as path, command, domain, and argument metadata.
3. Proxy evaluates method policy, deny rules, approval rules, allow rules, then default deny.
4. If denied, proxy returns an MCP-compatible error and does not forward the call.
5. If approval is required and a runtime approval hook exists, proxy forwards only after the hook
   approves.
6. If approval is required and no runtime approval hook exists, proxy denies the call.
7. If allowed, proxy forwards the call to the upstream server.
8. Proxy redacts and writes the decision audit event.

## Failure Flow

- Invalid policy: startup fails with configuration error.
- Unclassified risky capability: call is denied by default.
- Unsupported method: request is denied by default and is not passed through.
- JSON-RPC request envelope with unknown trace, debug, or vendor fields: envelope is rebuilt before
  forwarding and the extra fields are recorded as redaction.
- Approval hook rejection: call is denied and is not passed through; the hook's raw rejection reason
  is not forwarded or stored in audit events.
- Approval hook failure: call fails closed with a redacted denial instead of forwarding or storing
  hook error details.
- Approval hook unavailable: approval-required call is denied and is not passed through.
- Unmatched upstream response: response is dropped with a redacted audit event.
- Pending request state expiration or capacity exhaustion: stale responses are treated as
  unmatched, and new over-capacity requests are denied before forwarding.
- Concurrent tool discovery: a second `tools/list` request is denied while the previous discovery
  response is still pending.
- Oversized or overly deep JSON-RPC message: message is denied or dropped before forwarding.
- Upstream error response with data, non-standard fields, or sensitive message: error is sanitized
  before forwarding.
- JSON-RPC response envelope with unknown trace, debug, or vendor fields: envelope is rebuilt
  before forwarding and the extra fields are recorded as redaction.
- Malformed tool discovery result: visible tool state is cleared and an empty tool list is
  forwarded without the malformed raw payload.
- Audit write failure: fail closed by default; policy may explicitly choose warn-and-continue.
- Upstream server crash: proxy exits with the upstream-failure CLI code and records a redacted error
  audit event without converting the crash into policy success.
- Upstream shutdown hang: proxy kills the process after the shutdown grace window and records a
  redacted upstream-failure audit event.
- Upstream stdout close without process exit: proxy kills the process after the shutdown grace
  window and records a redacted upstream-failure audit event.
