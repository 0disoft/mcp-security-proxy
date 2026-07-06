# System Boundary

Status: Draft

## Boundary

MCP Security Proxy owns the local MCP protocol boundary between an MCP client or host and an MCP
server process. It can inspect and modify MCP messages that pass through the proxy. It cannot
control side effects performed directly by the server process outside those messages.

## Owned Contracts

- Policy file schema and evaluation order
- MCP method allowlist and unsupported-method denial behavior
- Tool discovery filtering
- Tool capability classification vocabulary
- Tool call allow, deny, and approval decisions
- Redaction behavior before audit writes
- JSON Lines audit event schema
- CLI command behavior and exit-code contract
- Library API for embedders

## External Contracts

- MCP message shapes and transport behavior
- Operating system process, file, shell, and network behavior
- Host approval UI, if a host integrates one
- Downstream storage or log processing for audit events

## Trust Boundaries

- MCP host/client: trusted to connect intentionally, but may be fooled by prompt injection or user
  mistakes.
- Upstream MCP server: untrusted even when installed intentionally.
- Policy file: trusted configuration, but potentially misconfigured.
- Audit destination: local sensitive sink that must receive redacted events only.

## Enforcement and Decision Boundaries

- Policy enforcement point: proxy runtime that intercepts MCP messages and applies decisions.
- Policy decision point: core evaluator that receives normalized facts and returns decisions.
- Redaction boundary: redactor must run before audit writes, JSON command output, and error details.

## Out of Boundary

- OS sandboxing
- Container isolation
- Malware scanning
- Secret vaults
- Hosted policy control planes
- MCP server marketplace

## Runtime Flow

1. Host starts the proxy with a server profile and policy file.
2. Proxy starts or connects to the configured MCP server.
3. Proxy applies the supported MCP method policy.
4. Server reports available tools.
5. Proxy classifies tools and filters discovery output.
6. Client sends a tool call.
7. Proxy normalizes call facts and evaluates the call against policy.
8. Proxy either forwards the call, denies it, or returns an approval-required decision.
9. Proxy writes a redacted audit event.

## Quality Attributes

- Security: deny by default for unsupported methods and risky or unknown capabilities.
- Privacy: audit events must be useful without raw secrets or full sensitive payloads.
- Operability: every decision should be explainable by policy rule, tool identity, and capability.
- Compatibility: MCP protocol behavior must be fixture-tested before compatibility claims.
- Maintainability: CLI and library contracts must stay synchronized.
