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
method policy also allows `ping`. Server-origin `ping` is liveness-only: `params` must be absent or
an empty object. Any non-empty or non-object `params` value is denied without forwarding raw payload
data.
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
Valid upstream error responses are forwarded with `code` and `message`, but any upstream
`error.data` member is removed before forwarding and recorded as a redaction event. Proxy-generated
errors may include the proxy's own redacted decision data.

## Discovery Policy

`tools/list` responses are not trusted as proof of safety. Tool descriptors may be incomplete,
misleading, or stale. Discovery filtering may hide tools from the host, but call-time evaluation is
still required because the upstream server and tool arguments remain untrusted.
Each filtered `tools/list` response replaces the current session's visible tool set. A tool that was
visible in an earlier discovery response must not remain callable after a later filtered discovery
response hides or omits it.
Pending request/response correlation must preserve the JSON-RPC id type. For example, numeric id
`1` and string id `"1"` must not match the same pending `tools/list` request.

## Call Policy

`tools/call` requests must be normalized into policy facts before evaluation. Denied calls must not
be forwarded upstream. Approval-required calls must be denied when no host approval hook is
configured.
Call-time evaluation only applies to tools that were visible in filtered discovery for the current
session. A direct call to a tool that was never discovered, or was hidden by discovery filtering,
must be denied instead of being allowed by name-based classifier heuristics.

## Audit Events

Every denied unsupported method, filtered discovery result, approval-required decision, and denied
call should create a redacted audit event. Audit events must not contain raw tool arguments or raw
MCP payloads.
