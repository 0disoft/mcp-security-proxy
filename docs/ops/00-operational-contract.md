# Operational Contract

Status: Draft

## Operational Contract

MCP Security Proxy is currently a local CLI and library boundary for stdio MCP servers. It is not a
hosted service and does not own fleet uptime, tenant routing, remote storage, dashboards, or a
managed control plane.

Current critical journeys:

- validate a local policy file before use;
- run a stdio MCP server behind the proxy;
- keep live `run` stdout reserved for MCP protocol frames;
- deny unsupported, ambiguous, or approval-required calls unless the configured runtime path can
  safely approve them;
- write redacted JSONL audit events to the operator-selected path;
- fail closed on policy parse, audit write, upstream protocol, or approval-hook failures.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: SECURITY.md for sensitive security issues; repository issues for non-sensitive
  operational defects

## Operational Priorities

1. Do not leak secrets, raw prompts, raw environment values, or full sensitive tool arguments.
2. Preserve MCP protocol framing on stdout in live `run` mode.
3. Prefer denial or startup failure over silent passthrough when policy, audit, protocol, or
   approval state is uncertain.
4. Keep compatibility claims fixture-backed.

## Data Ownership

- Policy files are local operator-owned inputs.
- Audit logs are local operator-owned outputs.
- The repository owns schemas, redaction rules, and CLI behavior, not retention infrastructure.
- No project-owned database exists in the current architecture.

## Validation

- Required validation names: docs, package-surface, secret-scan, artifact-safety, contract, test,
  smoke, check.
- Release blocker status: public release is blocked when local `check`, audit redaction, stdout
  separation, or package-surface validation fails.
- Remaining operational risk: no hosted health endpoint, metrics, dashboards, or alerting exists;
  this is acceptable for local stdio MVP but not for future hosted or HTTP transport modes.
