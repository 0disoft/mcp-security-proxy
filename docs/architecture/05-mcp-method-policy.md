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

## Discovery Policy

`tools/list` responses are not trusted as proof of safety. Tool descriptors may be incomplete,
misleading, or stale. Discovery filtering may hide tools from the host, but call-time evaluation is
still required because the upstream server and tool arguments remain untrusted.

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
