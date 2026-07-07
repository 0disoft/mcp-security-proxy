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

Audit export is append-only JSON Lines at the path selected by `--audit-log`. Each line is one
`msp.audit-event.v1` object. Export tools may forward those lines to local files, object storage,
or external log collectors, but this repository does not own collector agents, hosted storage,
dashboards, alert routing, or SIEM integrations.

Export allowlist:

- `schemaVersion`
- `kind`
- `profileId`
- optional `toolName`
- optional `method`
- `decision.action`
- `decision.evidence[].code`
- `decision.evidence[].ruleId`
- `decision.evidence[].capability`
- `decision.evidence[].reason`
- `redaction.applied`
- `redaction.counts`

Exported audit events must not contain raw secrets, environment values, prompt contents, full tool
arguments, raw upstream stderr lines, `error.data`, or unredacted upstream error messages. Audit
events may include stable decision codes, method names, profile names, tool names, rule ids,
capabilities, human-readable decision reasons, and redaction counts.

Operator responsibilities:

- choose an audit-log path outside generated, cache, dependency, and build output;
- configure file permissions, rotation, retention, backup, deletion, and sharing outside this
  repository;
- treat audit logs as sensitive operational evidence even when redacted;
- preserve redacted excerpts rather than full local audit files for public issues;
- verify collector transforms do not add raw request payloads or environment snapshots.

Failure and recovery:

- Live `run` must fail closed when audit writes fail.
- Rotation or collector failures are local operator incidents, not repository-managed retry queues.
- Recovery evidence should name the command, exit code, policy profile, audit event kind, decision
  action, and redaction summary without attaching raw prompts or raw arguments.

## Release Observability Gate

Before public release, validation evidence must include:

- a denied call audit fixture;
- redaction behavior for sensitive upstream failures;
- documented stdout/stderr separation for live `run`;
- operator guidance for audit log path ownership and retention;
- export guidance that names the audit field allowlist and forbidden raw data;
- incident evidence that does not require raw prompts, raw tool arguments, or raw secrets.

## Validation

- Required validation names: docs, artifact-safety, repository-hygiene, smoke, check.
- Release blocker status: public release is blocked if audit retention ownership is omitted or
  described as repository-managed storage.
- Remaining operational risk: no metrics, traces, dashboards, alerts, or built-in health endpoint
  exist yet; this is acceptable for local stdio MVP but not for hosted or HTTP transports.
