# Release

Status: Draft

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: SECURITY.md for security reports; repository issues for non-sensitive release
  issues

## Release Stages

- `0.1.0-alpha`: dry-run CLI and contracts only.
- `0.2.0-alpha`: stdio live proxy with fake-server integration evidence. Current implementation
  has a live stdio bridge, bounded shutdown, MCP-only stdout, response validation, direction
  gates, frame guards, audit logging, and runtime approval hooks.
- `0.3.0-beta`: embeddable library hardening, package surface review, observability guidance,
  and public API review.
- `1.0.0`: policy schema, audit schema, CLI JSON output, deny-by-default examples, fixture corpus,
  SECURITY.md, and vulnerability process are stable enough for external users.

Implementation direction is TypeScript with pnpm. The current implementation floor is Node.js
`>=24.0.0`. Registry targets, public package names, and release artifact names remain UNDECIDED
until implementation-time verification records them.

## Public Release Readiness

The repository is not ready for public npm release while package names and artifacts remain
UNDECIDED. Before publishing any public artifact, a release record must name:

- the public package names and package ownership boundaries;
- the registry target and publish credentials owner;
- the release artifact list;
- the package version to publish;
- the exact validation output for `docs`, `schema-contract`, `package-surface`, `secret-scan`,
  `compatibility`, `license-report`, `release-readiness`, `performance-smoke`, `contract`, `test`,
  `smoke`, and `check`;
- the rollback path for a bad package or CLI release.

Until that record exists, package manifests must stay private and versioned as `0.0.0`.
Release records live under `docs/ops/release-records/*.release.json`; use
`docs/ops/release-records/public-release.template.json` as the starting shape. `pnpm run
release-readiness` validates release records and enforces the private-package posture when no record
exists.

## Release Blockers

- Missing LICENSE or SECURITY.md.
- Missing migration notes for policy, audit, CLI JSON, exit-code, or public API changes.
- `pnpm run schema-contract` fails.
- Raw secret-like values in audit examples or public fixtures.
- Compatibility claims without fixture-backed evidence.
- `pnpm run license-report` fails after dependencies exist.
- Release artifact includes real logs, real policies, private captures, or exploit corpus data.
- `pnpm run package-surface` fails.
- `pnpm run compatibility` fails.
- `pnpm run release-readiness` fails.
- `pnpm run performance-smoke` fails for changed hot-path behavior.
- Package manifests are public before release readiness records public names and artifacts.

## Validation

- Required validation names: docs, schema-contract, package-surface, secret-scan, compatibility,
  license-report, release-readiness, performance-smoke, contract, test, smoke, check when commands
  exist.
- Release blocker status: blocked for public npm release until package naming, artifact naming,
  publish credentials ownership, and rollback records exist.
- Remaining operational risk: release automation does not exist yet; manual release is not allowed
  without a release readiness record.
