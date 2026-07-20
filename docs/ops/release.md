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
`>=24.0.0`. The published `0.2.0-alpha.2` and `0.2.0-alpha.3` records remain historical evidence,
while the published `0.2.0-alpha.4` record names npmjs.org, five public packages, their artifact
names, and npm Trusted Publisher ownership. The package names were initialized with the bootstrap
marker before the first OIDC product release.

## Public Release Readiness

Before publishing any public product artifact, an approved release record must name:

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
release record whose `targetCommit` remains reachable from current HEAD. For repeated releases of
the same package, the latest descendant target on one linear history owns current manifest posture;
same-target version conflicts and incomparable approval histories fail validation. Unreachable
approved records remain historical evidence, but they do not unlock current package manifests. Approved
release records must include the executed validation command and `exit 0` for every required
validation evidence value. Approved release records must also use a tracked `docs/ops` rollback
procedure and a last-known-good version that is different from the release version being approved.
The approved target commit must be reachable from the release tag commit. The publish preflight
permits only the matching release-record file to change between those commits; any source,
workflow, package, test, or unrelated documentation change requires a new approved target.
The package-surface validation also packs the five candidate artifacts, rejects undeclared tarball
paths and unresolved workspace protocols, installs them into a clean offline npm consumer, checks
ESM and TypeScript imports against the supported Node 24 type baseline, and runs the installed CLI
help command. This evidence does not prove that npm ownership or Trusted Publisher configuration
exists.

External runtime dependencies are fail-closed through
`docs/ops/external-runtime-dependencies.json`: each entry pins the owning workspace package,
dependency group, exact version, purpose, and accepted ADR. This decision ledger does not rewrite
historical release records or authorize publication; the next release still needs its own approved
record and complete package evidence.

After all five immutable versions are published, the release workflow runs `pnpm run
registry-smoke`. This post-publication check requires the exact tag version, verifies npm registry
integrity and SLSA provenance metadata, installs all five packages without lifecycle scripts or npm
credentials, repeats the shared ESM, TypeScript, and CLI consumer checks, and runs a complete MCP
stdio onboarding session with the registry-installed CLI and pinned filesystem server. That session
proves filtered discovery, one allowed read, one default-denied read, orderly shutdown, and redacted
audit evidence without using checkout build output. It cannot be used as pre-publication approval
evidence. Failure after publication triggers the rollback and deprecation procedure; it never
retries `npm publish` for the same immutable version.

After registry smoke succeeds, a separate least-privilege workflow job creates or verifies the
GitHub Release for the existing version tag. It uses the job-scoped automatic `GITHUB_TOKEN` with
only `contents: write`; the npm publish job retains `contents: read` and `id-token: write`. Release
creation is idempotent, derives prerelease status from exact SemVer, generates release notes, and
fails if an existing Release has the wrong draft or prerelease state. Retry only the failed
`github-release` job after a transient API failure; never rerun successful immutable publish steps.

Completed publication evidence lives under `docs/ops/publications/*.publication.json`. A
publication receipt records the immutable release tag and commit, successful Release and Registry
Smoke workflow runs, observed npm dist-tags, package integrity values, and SLSA provenance linkage.
Version 2 receipts additionally pin the public GitHub Release ID and URL, the independently resolved
tag commit, draft/prerelease state, and Release publication and observation times. Historical v1
receipts remain valid. `pnpm run release-readiness` validates these receipts against their approved
release records and exact package sets. Receipt validation is offline consistency checking; only
`registry-smoke` and the receipt generator re-observe current public services.

The manually dispatched Registry Smoke requires the successful Release run ID in addition to the
exact version. Its structured run name triggers the read-only Publication Receipt workflow only
after Registry Smoke completes successfully. That follow-up resolves the release tag and reads the
published Release through the versioned GitHub API, revalidates both workflow runs and all public npm
metadata, and uploads the generated receipt as a temporary workflow artifact. It cannot commit or
rewrite publication records; an owner must review the artifact, place it under
`docs/ops/publications/`, run release readiness, and commit the immutable evidence.

The one-time package-name initialization path is owned by `docs/ops/npm-bootstrap.md` and
`docs/ops/npm-bootstrap-plan.json`. It stages `0.0.0-bootstrap.0` tarballs without changing source
manifests, uses only the non-default `bootstrap` dist-tag, and cannot run through the normal release
workflow. `pnpm run release-readiness` validates the offline bootstrap plan. Registry identity and
package-name absence are checked only when an owner explicitly runs the optional network preflight.
Release readiness also builds the staged bootstrap tarballs in a temporary directory, validates
their transformed manifests and file allowlists, and removes them without publishing.

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
- Bootstrap publication proceeds without an approved bootstrap plan, exact npm owner identity,
  absent package names, checksummed staging artifacts, or a credential-removal handoff.

## Validation

- Required validation names: docs, schema-contract, migration-check, package-surface, secret-scan,
  artifact-safety, repository-hygiene, validation-registry, ci-contract, compatibility, license-report,
  release-readiness, performance-smoke, contract, test, smoke, check when commands exist.
- Release blocker status: subsequent public releases remain blocked when the approved release
  record, Trusted Publisher ownership, local validation, or hosted release preflight is missing.
- Remaining operational risk: registry smoke runs after immutable versions exist. A detected bad
  publication must be deprecated and replaced with a new version rather than overwritten.
