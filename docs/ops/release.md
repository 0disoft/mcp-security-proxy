# Release

Status: Draft

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: SECURITY.md for security reports; repository issues for non-sensitive release
  issues

## Release Stages

- `0.1.0-alpha`: dry-run CLI and contracts only.
- `0.2.0-alpha`: stdio live proxy with fake-server integration evidence.
- `0.3.0-beta`: embeddable library hardening and public API review.
- `1.0.0`: policy schema, audit schema, CLI JSON output, deny-by-default examples, fixture corpus,
  SECURITY.md, and vulnerability process are stable enough for external users.

Implementation direction is TypeScript with pnpm. Exact Node.js floor, registry targets, package
names, and release artifact names remain UNDECIDED until implementation-time verification records
them.

## Release Blockers

- Missing LICENSE or SECURITY.md.
- Missing migration notes for policy, audit, CLI JSON, exit-code, or public API changes.
- Raw secret-like values in audit examples or public fixtures.
- Compatibility claims without fixture-backed evidence.
- Dependency license report missing after dependencies exist.
- Release artifact includes real logs, real policies, private captures, or exploit corpus data.

## Validation

- Required validation names: docs, contract, test, smoke, check when commands exist.
- Release blocker status: blocked until implementation and release automation exist.
- Remaining operational risk: no release process exists yet.
