# Product Specification

Status: Draft
Owner: 0disoft

## Purpose

Define the first product contract for MCP Security Proxy: a local proxy that mediates MCP tool
discovery and tool calls through explicit policy, redaction, and audit events.

## Source of Truth

- Product decision: this specification
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Boundary: stdio MCP proxy first; HTTP transport is a later compatibility target.
- Data ownership: all policy and audit files are local to the user or embedding host.
- Failure and recovery behavior: deny-by-default for unsupported methods, unknown high-risk
  capability, ambiguous matcher input, and missing approval hooks; explain denial and keep policy
  evaluation deterministic.
- Validation needed before merge: VALIDATION.md

## MVP Scope

- Start an MCP server behind a stdio proxy.
- Read a local policy file.
- Support a narrow method allowlist for `initialize`, `notifications/initialized`, `ping`,
  `tools/list`, and `tools/call`.
- Deny unsupported MCP methods instead of passing them through by default.
- Gate server-origin method-bearing messages by direction. Only payload-free liveness `ping` is
  forwarded from upstream server to client in the current contract.
- Forward upstream responses only when their JSON-RPC `id` exactly matches a pending client
  request, including the original id type.
- Filter tool discovery output before the client sees it.
- Evaluate tool calls before forwarding them.
- Match file paths against allow and deny scopes.
- Match shell commands against executable and argv allowlists.
- Express network domain allow and deny rules as argument-level intent policy.
- Redact environment values, secret-like strings, and sensitive audit fields.
- Remove upstream JSON-RPC `error.data` before forwarding and replace sensitive-looking upstream
  `error.message` strings with a generic message.
- Bound newline-delimited JSON-RPC frame size and parsed JSON depth.
- Emit JSON Lines audit events.
- Include stable decision evidence codes alongside human-readable reasons.
- Support dry-run policy evaluation for a captured tool list or tool call envelope.

## Policy Model

The policy model should be explicit and boring:

- default action: deny
- server profile: named policy section for one MCP server
- method policy: allow supported methods and deny unsupported method families
- tool rule: allow, deny, or require approval by tool name and capability
- path rule: allowed roots and denied roots after normalized path resolution
- command rule: executable plus argv pattern, not free-form shell acceptance
- network rule: domain allowlist and denylist for values present in tool-call arguments
- redaction rule: named detector with replacement token
- audit rule: event destination and content-capture limits
- decision evidence: stable code plus human-readable reason

## CLI Surface

Implemented command names:

- `mcp-security-proxy run`: run a server behind the proxy.
- `mcp-security-proxy check-policy`: validate a policy file.
- `mcp-security-proxy inspect-tools`: classify a server tool list.
- `mcp-security-proxy eval-call`: dry-run one tool call against policy.

The `run` command uses stdout only for MCP protocol messages after startup. Usage errors go to
stderr, and audit events go to the file selected by `--audit-log`.

## Library Surface

The first library should expose policy parsing, tool classification, call evaluation, redaction, and
audit event formatting as separate units so hosts can embed them without using the CLI process.

## Exclusions

- Complete OS sandboxing
- Process isolation
- Malware detection
- Secret vault behavior
- Hosted policy management
- MCP marketplace or registry

## Review Blockers

- The change weakens deny-by-default behavior.
- The change stores raw secret-bearing values in audit logs.
- The change treats tool schemas as sufficient proof of safety.
- The change passes unsupported MCP methods through without policy.
- The change adds broad shell or path allowances without testable matching semantics.
- The change describes network policy as OS-level socket enforcement.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
