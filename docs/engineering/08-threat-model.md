# Threat Model

Status: Draft

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Assets

- local files and paths referenced by MCP tools
- shell command execution capability
- network targets supplied through tool arguments
- environment values and credentials
- prompt contents and tool arguments
- policy files and server profiles
- redacted audit events and decision evidence

## Actors

- User: configures local policy and chooses upstream MCP servers.
- MCP host/client: may be tricked by model output or prompt injection.
- Upstream MCP server: untrusted process that may expose risky tools or perform side effects.
- Policy author: trusted but fallible.
- Attacker: may influence prompts, tool arguments, MCP server packages, or captured fixtures.

## Trust Boundaries

- Host to proxy: protocol messages and runtime options enter the enforcement boundary.
- Proxy to upstream server: allowed messages leave the boundary.
- Policy file to evaluator: trusted configuration may still be wrong.
- Evaluator to audit sink: only redacted event summaries may cross this boundary.
- Public repository to users: only synthetic fixtures and public-safe examples may be published.

## Threats

- Tool schema or description hides dangerous behavior.
- Unsupported MCP method bypasses tool-call policy.
- Server performs file, shell, or network side effects outside MCP messages.
- Path traversal, symlink, platform, or Unicode behavior bypasses path policy.
- Broad command allowlists permit arbitrary shell execution.
- Network argument policy is mistaken for socket enforcement.
- Audit logs expose raw secrets, prompts, environment values, or sensitive arguments.
- Approval prompts become so noisy that users approve everything.
- SDK or spec drift changes protocol behavior without fixture updates.
- Public fixtures accidentally include real logs, real captures, or private bypass details.

## Mitigations

- Deny by default for unknown capability and unsupported method.
- Keep classifier evidence separate from permission decisions.
- Keep path, command, and network matcher semantics explicit and fixture-backed.
- Use redacted summaries for audit and JSON output.
- Keep approval as an optional hook, not the default product center.
- Keep core evaluation independent from runtime IO and SDK dependencies.
- Maintain a private boundary for exploit corpus and real operational data.

## Review Blockers

- A change expands the trust boundary without updating this threat model.
- A change claims protection for upstream side effects outside MCP messages.
- A change weakens default deny, redaction, or unsupported-method handling.
- A change weakens validation or hides skipped checks.
