# Architecture

Status: Draft

## Boundary

MCP Security Proxy is a local protocol-boundary component. It sits between an MCP client or host
and an upstream MCP server. The proxy can inspect tool discovery and tool call messages, apply
local policy, redact audit fields, and decide whether a call should be forwarded.

The architecture deliberately stops at the MCP boundary. It does not promise kernel isolation,
container sandboxing, malware detection, or control over side effects that an upstream server
performs outside MCP messages.

The runtime is split into a policy enforcement point and a policy decision point. The proxy runtime
is the enforcement point: it holds MCP messages, forwards allowed traffic, denies blocked traffic,
and writes audit events. The core evaluator is the decision point: it evaluates normalized facts
against policy and returns allow, deny, or approval-required decisions.

## Runtime Flow

1. Load policy and selected server profile.
2. Start or connect to upstream MCP server.
3. Apply the MVP MCP method allowlist.
4. Intercept tool discovery and classify capabilities.
5. Filter tool discovery before the client sees it.
6. Normalize tool calls into policy facts.
7. Evaluate each tool call against policy.
8. Forward, deny, or mark the call for approval.
9. Redact and write the audit event.
10. Return upstream results or policy errors to the client.

Unsupported MCP methods are denied by default, not passed through blindly. Network policy is
argument-level intent policy; it does not claim to block sockets opened directly by an upstream
server.

## Quality Attributes

- Security: deny-by-default for unknown methods, unknown capabilities, and high-risk capability.
- Privacy: audit events must avoid raw secrets and sensitive payloads.
- Explainability: every decision must point to a rule, capability, and reason.
- Compatibility: MCP client/server claims require fixture-backed evidence.
- Maintainability: CLI command contracts and library APIs must stay synchronized.
