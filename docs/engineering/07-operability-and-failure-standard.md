# Operability and Failure Standard

Status: Draft

## Contract

Operability standard connects code changes to logs, metrics, traces, rollback, runbooks, health checks, incident response, and failure evidence.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: .agents/checklists/ops-change.md

## Failure Policy

- Invalid policy fails before proxy startup.
- Unsupported methods are denied and audited.
- Denied calls are returned to the host as MCP-compatible errors and are not forwarded upstream.
- Missing approval hook turns approval-required into deny.
- Audit write failure fails closed unless policy explicitly selects warn-and-continue.
- Upstream crash is reported as upstream failure, not policy success.

## Evidence

- Human output explains the failure without secrets.
- JSON output is redacted and stable enough for contract tests.
- Audit events include rule IDs, capability labels, decision, and high-level reason.
- Recovery instructions should prefer policy edits, fixture updates, or rollback to the previous
  release artifact.

## Review Blockers

- A failure path proceeds silently or without redacted evidence.
- A policy denial is treated as a proxy crash.
- A runtime failure is converted into policy success.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
