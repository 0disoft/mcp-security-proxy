# Release

Status: Draft

## Owners

- Primary owner: 0disoft
- Backup owner: 0disoft
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
- the full Git commit SHA being approved for release;
- the exact validation output for `docs`, `schema-contract`, `migration-check`, `package-surface`,
  `secret-scan`, `artifact-safety`, `repository-hygiene`, `validation-registry`, `ci-contract`,
  `compatibility`, `license-report`, `release-readiness`, `performance-smoke`, `contract`, `test`,
  `smoke`, and `check`;
- the rollback path for a bad package or CLI release.
- whether external MCP client/server compatibility fixtures are included or explicitly excluded
  from the release scope.

Until that record exists, package manifests must stay private and versioned as `0.0.0`.
Proposed or blocked release records may describe a future release version, but they do not permit
package manifests to leave the `0.0.0` private posture. Approved release records must name a
non-`0.0.0` release version and the current target commit before package manifests can move to
public release posture.
Release records live under `docs/ops/release-records/*.release.json`; use
`docs/ops/release-records/public-release.template.json` as the starting shape. `pnpm run
release-readiness` validates release records and enforces the private-package posture when no record
exists. `pnpm run artifact-safety` checks public fixtures and release artifact references for
private, raw synthetic leak marker, real-log, generated-output, capture, and exploit-corpus paths. `pnpm run
repository-hygiene` checks tracked files, ignore rules, line endings, and generated-output
exclusions. `pnpm run validation-registry` keeps validation names synchronized across
`VALIDATION.md`, agent validation profiles, runner scripts, release-readiness requirements, and
release-record templates. `pnpm run ci-contract` checks hosted CI parity with documented local
validation and runtime versions. `pnpm run package-surface` keeps non-release packages private and
only allows release-version public package posture for `packages/*` entries named by an approved
release record. Approved release records must include the executed validation command and `exit 0`
for every required validation evidence value. Approved release records must also use a tracked
`docs/ops` rollback procedure and a last-known-good version that is different from the release
version being approved. The approved target commit must be reachable from the current repository
HEAD so the release record remains verifiable after later commits.

## Release Blockers

- Missing LICENSE or SECURITY.md.
- Missing migration notes for policy, audit, CLI JSON, exit-code, or public API changes.
- `pnpm run schema-contract` fails.
- `pnpm run migration-check` fails.
- Raw secret-like values in audit examples or public fixtures.
- `pnpm run artifact-safety` fails.
- `pnpm run repository-hygiene` fails.
- `pnpm run validation-registry` fails.
- `pnpm run ci-contract` fails.
- Compatibility claims without fixture-backed evidence.
- External MCP client/server compatibility claims without fixture-backed evidence or an explicit
  release-scope exclusion.
- `pnpm run license-report` fails after dependencies exist.
- Release artifact includes real logs, real policies, private captures, or exploit corpus data.
- `pnpm run package-surface` fails.
- `pnpm run compatibility` fails.
- `pnpm run release-readiness` fails.
- `pnpm run performance-smoke` fails for changed hot-path behavior.
- Package manifests are public before release readiness records public names and artifacts.

## Validation

- Required validation names: docs, schema-contract, migration-check, package-surface, secret-scan,
  artifact-safety, repository-hygiene, validation-registry, ci-contract, compatibility, license-report,
  release-readiness, performance-smoke, contract, test, smoke, check when commands exist.
- Release blocker status: blocked for public npm release until package naming, artifact naming,
  publish credentials ownership, and rollback records exist.
- Remaining operational risk: release automation does not exist yet; manual release is not allowed
  without a release readiness record.
