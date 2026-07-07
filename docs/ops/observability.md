# Observability

Status: Draft

## Operational Contract

Cover logs, metrics, traces, dashboards, alerts, health checks, sampling, retention, and incident evidence quality.

## Owners

- Primary owner: 0disoft
- Backup owner: 0disoft for audit-event contracts; local operators for audit-log retention
- Escalation path: SECURITY.md for sensitive security evidence; repository issues for
  non-sensitive operational defects

## Current Signals

- CLI stderr is human-readable operational output.
- CLI stdout is reserved for MCP protocol frames in live `run` mode.
- `--audit-log` writes redacted JSONL audit events.
- Upstream stderr is summarized by line count and is not copied raw.
- Upstream response `error.data` is stripped before forwarding.
- Sensitive upstream `error.message` content is redacted before forwarding.

## Audit Export Rules

- Audit logs must not contain raw secrets, environment values, prompt contents, or full tool
  arguments.
- Audit events may include stable decision codes, method names, profile names, and redacted
  evidence.
- Audit JSONL can be shipped by external log collectors, but this repository does not own a SIEM
  integration.
- Audit retention, backup, deletion, and sharing are operator-owned in the current local stdio
  architecture.

## Release Observability Gate

Before public release, validation evidence must include:

- a denied call audit fixture;
- redaction behavior for sensitive upstream failures;
- documented stdout/stderr separation for live `run`;
- operator guidance for audit log path ownership and retention;
- incident evidence that does not require raw prompts, raw tool arguments, or raw secrets.

## Validation

- Required validation names: docs, smoke, check.
- Release blocker status: public release is blocked if audit retention ownership is omitted or
  described as repository-managed storage.
- Remaining operational risk: no metrics, traces, dashboards, alerts, or built-in health endpoint
  exist yet; this is acceptable for local stdio MVP but not for hosted or HTTP transports.
