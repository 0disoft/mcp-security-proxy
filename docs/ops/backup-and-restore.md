# Backup and Restore

Status: Draft

## Operational Contract

This project currently owns no hosted storage, database, queue, or managed runtime state. Backup and
restore applies to repository source, local policy files, and local audit logs selected by the
operator.

## Owners

- Primary owner: 0disoft for repository source and release artifacts
- Backup owner: 0disoft for repository source; local operators for policy and audit backups
- Escalation path: repository issues for non-sensitive restore defects; SECURITY.md for restore
  paths that expose sensitive data

## Restore Boundaries

- Repository source is restored from Git.
- Generated `dist/`, cache, and dependency output are rebuilt, not backed up.
- Local policy files are operator-owned and should be backed up by the operator if they matter.
- Local audit logs are operator-owned evidence and may contain redacted security events.

## RTO and RPO

- Repository source RTO: restore by checkout and dependency install.
- Repository source RPO: last pushed commit.
- Local policy and audit RTO/RPO: operator-defined.

## Integrity Checks

- After repository restore, run `pnpm run check`.
- After policy restore, run `mcp-security-proxy check-policy --policy <path> --json`.
- After audit-log restore, verify line-delimited JSON shape without publishing raw sensitive
  evidence.

## Validation

- Required validation names: docs, smoke, check.
- Release blocker status: public release is blocked if release artifacts require untracked local
  state to restore.
- Remaining operational risk: local operator policy and audit backup are outside repository
  control.
