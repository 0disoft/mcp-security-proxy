# Architecture

Status: Draft

## Boundary

MCP Security Proxy is a local protocol-boundary component. It sits between an MCP client or host
and an upstream MCP server. The proxy can inspect tool discovery and tool call messages, apply
local policy, redact audit fields, and decide whether a call should be forwarded.

The architecture deliberately stops at the MCP boundary. It does not promise kernel isolation,
container sandboxing, malware detection, or control over side effects that an upstream server
performs outside MCP messages.

## Runtime Flow

1. Load policy and selected server profile.
2. Start or connect to upstream MCP server.
3. Intercept tool discovery and classify capabilities.
4. Filter tool discovery before the client sees it.
5. Evaluate each tool call against policy.
6. Forward, deny, or mark the call for approval.
7. Redact and write the audit event.
8. Return upstream results or policy errors to the client.

## Quality Attributes

- Security: deny-by-default for unknown or high-risk capability.
- Privacy: audit events must avoid raw secrets and sensitive payloads.
- Explainability: every decision must point to a rule, capability, and reason.
- Compatibility: MCP client/server claims require fixture-backed evidence.
- Maintainability: CLI command contracts and library APIs must stay synchronized.
