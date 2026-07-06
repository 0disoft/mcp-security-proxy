# CI

Status: Draft

## Operational Contract

Cover required checks, branch protection, pipeline stages, artifacts, failure policy, local parity, and stop conditions.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive failures; SECURITY.md for sensitive failures

## Local Check Contract

The current local CI equivalent is:

```powershell
pnpm check
```

`pnpm check` runs:

- workspace TypeScript typecheck
- workspace tests
- contract checks for contracts and core
- documentation contract check

## Validation

- Required validation names: typecheck, test, contract, docs, check.
- Release blocker status: GitHub Actions CI is not configured yet.
- Remaining operational risk: local checks pass, but remote CI still needs a workflow.
