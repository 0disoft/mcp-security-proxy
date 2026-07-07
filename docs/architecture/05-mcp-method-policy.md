# MCP Method Policy

Status: Draft

## Purpose

Define which MCP protocol methods the first proxy contract understands and how unsupported methods
are handled.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## MVP Method Set

The first live proxy target is stdio. The MVP method set is intentionally narrow:

- `initialize`
- `notifications/initialized`
- `ping`
- `tools/list`
- `tools/call`

The proxy may need to forward or respond to additional protocol lifecycle messages in the future,
but each additional method must be documented before it becomes pass-through behavior.

## Unsupported Methods

Unsupported methods must not be blindly passed through. This includes, but is not limited to:

- `resources/*`
- `prompts/*`
- `sampling/*`
- `roots/*`
- `elicitation/*`
- unknown future MCP methods

Default behavior for unsupported methods is deny with an MCP-compatible error and a redacted audit
event. A future ADR may add support for a method family only after its data flow, privacy impact,
and policy hooks are documented.
Method-bearing messages from either side of the proxy must pass the configured method allowlist
before they are forwarded. Direction matters: `initialize`, `notifications/initialized`,
`tools/list`, and `tools/call` are client-originated in the MVP. The only upstream
server-originated method currently forwarded is `ping`, and it is forwarded only when the configured
method policy also allows `ping`. Method shape matters too: `initialize`, `ping`, `tools/list`, and
`tools/call` are request-style methods and must carry a JSON-RPC `id`; `notifications/initialized`
is a notification and must omit `id`. Server-origin `ping` is liveness-only and must be a request
with an `id`; `params` must be absent or an empty object. Any missing `id`, non-empty `params`, or
non-object `params` value is denied without forwarding raw payload data.
An upstream server request or notification must not be mistaken for a response to a pending client
request, even when it reuses the same JSON-RPC id. Denied upstream server requests with an id
receive a JSON-RPC error response back to the upstream server; denied upstream notifications are
dropped with a redacted audit event.

## Envelope Validation

Malformed JSON-RPC envelopes must not be forwarded across the proxy boundary. The runtime accepts
only JSON-RPC 2.0 objects whose `id`, when present, is a string, number, or `null`, and whose
`method`, when present, is a string. Request or notification envelopes must not include `result` or
`error`. Response envelopes must include an `id` and exactly one of `result` or `error`; an `error`
member must be an object with numeric `code` and string `message` fields. Invalid client messages
return `-32600`; invalid upstream server messages are dropped with a redacted audit event.
Each newline-delimited frame is bounded before parsing. The default maximum frame size is 1 MiB,
and the default parsed JSON depth limit is 64. Hosts may configure stricter or looser limits within
the CLI-supported bounds, but oversized or overly deep frames fail closed before forwarding.
Valid upstream error responses are rebuilt with only `code` and a sanitized `message`. Any upstream
`error.data` member and any non-standard upstream error fields, such as stack traces, debug
metadata, or nested details, are removed before forwarding and recorded as redaction. If the
upstream `error.message` looks sensitive, such as a path, URL, or redaction marker, the proxy
replaces the message with a generic redacted message and records that redaction. Proxy-generated
errors may include the proxy's own redacted decision data.
Valid upstream responses are forwarded only when their JSON-RPC `id` exactly matches a pending
client request, including the original id type. Responses that do not match a pending request are
dropped with a redacted audit event instead of being treated as unsolicited server messages.
Matched upstream responses are rebuilt before forwarding with only `jsonrpc`, `id`, and exactly one
of `result` or `error`; unknown response envelope fields such as trace, debug, or vendor metadata
are removed and recorded as redaction.
Client responses are forwarded upstream only when their JSON-RPC `id` exactly matches a pending
upstream server-origin request that the proxy already forwarded to the client. A client response
without a matching server-origin request is dropped with a redacted audit event.
Because server-origin `ping` is liveness-only, the matching client response must be an empty
`result` object. Client `ping` responses with non-empty `result` data or an `error` object are
dropped with a redacted audit event rather than forwarded upstream. Matching client `ping`
responses are also rebuilt with only the JSON-RPC response envelope fields before forwarding.
Requests with an `id` that already has a pending response in the same direction are denied before
forwarding so one request cannot overwrite another request's correlation state.

## Discovery Policy

`tools/list` responses are not trusted as proof of safety. Tool descriptors may be incomplete,
misleading, or stale. Discovery filtering may hide tools from the host, but call-time evaluation is
still required because the upstream server and tool arguments remain untrusted.
Visible discovery descriptors are rebuilt before forwarding. The MVP proxy forwards only `name`,
optional `title`, optional `description`, object-valued `inputSchema`, object-valued
`outputSchema`, and object-valued `annotations`; unknown descriptor top-level fields, including
`_meta`, are removed at the protocol boundary. The `tools/list` success result itself is also
rebuilt with only `tools` and optional string `nextCursor`, so result-level debug or vendor fields
are not forwarded. Forwarded schema and annotation objects also remove nested metadata keys that
commonly carry example or debug values: `default`, `example`, `examples`, `$comment`, and `_meta`.
Forwarded schemas remain usability hints, not safety proof.
Malformed `tools/list` success results, including non-array `tools` members or missing result
objects, are sanitized to an empty `tools` array before forwarding. The malformed raw discovery
payload must not be forwarded or stored in audit events.
When multiple visible descriptors use the same tool `name`, the proxy forwards only the first
sanitized descriptor and hides later duplicates. This keeps the client-visible tool list aligned
with the call-time visible-tool state, which is keyed by tool name.
Each filtered `tools/list` response replaces the current session's visible tool set. A tool that was
visible in an earlier discovery response must not remain callable after a later filtered discovery
response hides or omits it.
Pending request/response correlation must preserve the JSON-RPC id type. For example, numeric id
`1` and string id `"1"` must not match the same pending `tools/list` request.

## Call Policy

`tools/call` requests must be normalized into policy facts before evaluation. Denied calls must not
be forwarded upstream. Approval-required calls must be forwarded only after an embedding host
approval hook approves them. Approval-required calls must be denied when no runtime approval hook is
configured, and the CLI does not bundle approval UX.
Call-time evaluation only applies to tools that were visible in filtered discovery for the current
session. A direct call to a tool that was never discovered, or was hidden by discovery filtering,
must be denied instead of being allowed by name-based classifier heuristics.

## Audit Events

Every denied unsupported method, filtered discovery result, approval-required decision, and denied
call should create a redacted audit event. Audit events must not contain raw tool arguments or raw
MCP payloads. Decision evidence should include a stable `code` alongside the human-readable
`reason` so downstream audit consumers do not have to parse reason strings as an API.
