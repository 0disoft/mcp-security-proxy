# Incident Response

Status: Draft

## Operational Contract

Incident response covers local CLI/library failures, public package artifacts, policy/audit schema
regressions, and security-sensitive leakage reports. It does not cover hosted fleet operations
because this project does not currently run a hosted service.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: SECURITY.md for vulnerabilities or sensitive evidence; repository issues for
  non-sensitive defects

## Severity Guide

- SEV1: secret, prompt, environment, or sensitive tool-argument leak in a public artifact, audit
  event, CLI output, or forwarded upstream error.
- SEV2: supported MCP method bypasses policy, approval-required calls forward without approval, or
  stdout protocol framing is corrupted in live `run`.
- SEV3: local validation, docs, package-surface, or compatibility evidence drifts from
  implementation.

## First 10 Minutes

1. Stop distributing the affected package, fixture, or documentation path when public exposure is
   possible.
2. Preserve only redacted evidence: command, exit code, package version or commit, policy shape,
   audit event type, and redacted error summary.
3. Reproduce locally with fixtures or fake values.
4. Identify whether the failure is policy, CLI usage, audit write, upstream protocol, approval hook,
   package artifact, or documentation drift.
5. Route sensitive details through SECURITY.md.

## Evidence Rules

- Do not attach raw prompts, raw tool arguments, raw environment values, credentials, cookies, or
  private audit logs to public issues.
- Use synthetic fixtures or redacted excerpts for regression tests.
- Record the validation names that prove the fix.

## Validation

- Required validation names: docs, contract, test, smoke, check.
- Release blocker status: any untriaged SEV1 or SEV2 blocks public release.
- Remaining operational risk: no automated security advisory workflow or release revocation
  automation exists yet.
