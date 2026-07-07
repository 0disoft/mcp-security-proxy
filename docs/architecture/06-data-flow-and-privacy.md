# Data Flow and Privacy

Status: Draft

## Purpose

Define how sensitive data moves through MCP Security Proxy and what must never be retained.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Data Classes

- Policy data: local policy files, profile names, rule identifiers, and matcher configuration.
- MCP metadata: method names, request identifiers, tool names, descriptor summaries, and decision
  metadata.
- Sensitive MCP payloads: raw tool arguments, prompt text, file paths, URLs, database strings, and
  command arguments.
- Secret-bearing data: environment values, tokens, API keys, credentials, cookies, private keys, and
  secret-like strings.
- Audit data: redacted decision records written for local review or host integration.

## Flow Rules

- Policy data is trusted configuration but may be misconfigured.
- Upstream MCP servers are untrusted.
- Tool descriptors are hints, not security proof.
- Tool discovery forwarding is allowlisted at the result and descriptor field boundaries. Unknown
  result metadata and unknown top-level descriptor metadata, including `_meta`, are not retained in
  forwarded discovery responses.
  Nested schema and annotation metadata keys that commonly carry example or debug values are also
  removed before forwarding.
- Malformed discovery success payloads are not forwarded as-is; they are replaced with an empty
  tool list and a redacted audit event.
- JSON-RPC request and notification envelopes are allowlisted to `jsonrpc`, `method`, optional
  `id`, and optional `params`; unknown envelope-level trace, debug, or vendor metadata is removed
  before forwarding.
- Upstream JSON-RPC error forwarding is allowlisted to `code` and sanitized `message`; error data,
  stack traces, debug fields, and nested details are removed before forwarding.
- JSON-RPC response envelopes are allowlisted to `jsonrpc`, `id`, and exactly one of `result` or
  `error`; unknown envelope-level trace, debug, or vendor metadata is removed before forwarding.
- Approval hook rejection reasons are host-owned input and are not forwarded or stored verbatim in
  proxy responses or audit events.
- Raw MCP payloads may be inspected for policy facts but must not be stored in audit events.
- Audit events receive redacted summaries only.
- Redaction must happen before audit write and before machine-readable CLI output.

## Environment and Token Rules

The proxy must not introduce token passthrough as a default feature. Environment variables may be
forwarded to upstream servers only through explicit allowlists. Audit events, shell completion, JSON
output, and error messages must not print environment values.

## Path and Prompt Rules

Full paths and prompt contents can be sensitive even when they are not secrets. Audit events should
prefer rule IDs, capability labels, path-scope labels, replacement counts, and high-level reasons
over full raw values.

## Retention

The project does not currently own retention infrastructure. Audit files are local
operator-selected artifacts, and operators own retention, backup, deletion, and sharing decisions.
Documentation and examples must treat audit files as local sensitive artifacts, not shareable logs.

## Public Repository Boundary

The public repository may include synthetic fixtures and redacted audit examples. It must not
include real user logs, real company policy files, real MCP captures, private exploit corpus data,
or private credentials. `pnpm run artifact-safety` guards public fixtures and release artifact
references against those boundary violations.
