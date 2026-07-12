# CI

Status: Draft

## Operational Contract

Cover required checks, branch protection, pipeline stages, artifacts, failure policy, local parity, and stop conditions.

## Owners

- Primary owner: 0disoft
- Backup owner: 0disoft
- Escalation path: repository issues for non-sensitive failures; SECURITY.md for sensitive failures

## Local Check Contract

The current local CI equivalent is:

```powershell
pnpm run check
```

`pnpm run check` runs:

- workspace TypeScript typecheck
- workspace tests
- contract checks for contracts and core
- documentation contract check
- schema contract checks
- migration-note checks
- package surface, tracked-file secret scans, public artifact safety checks, repository hygiene
  checks, validation registry checks, CI contract checks, compatibility evidence checks, dependency
  license report checks, release-readiness preflight checks, and performance smoke checks
- package tarball allowlist, offline npm installation, ESM import, declaration resolution, and
  installed CLI help checks for the five publishable candidates
- CLI smoke checks against the local fixture policy and the secret-label fixture policy

## Hosted Workflow

GitHub Actions runs `.github/workflows/ci.yml` on `main` pushes and pull requests. The workflow:

- checks out the repository
- installs Node.js 24.11.1
- enables pnpm 11.7.0 through Corepack
- installs the locked dependency graph
- runs `pnpm run check`
- runs `git diff --check`

`pnpm run ci-contract` keeps this workflow aligned with the documented Node.js version, pnpm
version, read-only permissions, pinned actions, local check command, and diff hygiene command.
CI workflows must not publish packages, create releases, request write permissions, request
`id-token: write`, or reference registry publish tokens.

## Release Workflow

`.github/workflows/release.yml` is the only tracked workflow allowed to request `id-token: write`.
It runs only for version tags matching `vMAJOR.MINOR.PATCH[-PRERELEASE]`, uses the npm environment
for Trusted Publisher ownership, fetches full Git history so reachable historical approval commits
can be verified, runs `pnpm run check`, verifies `scripts/check-release-publish-plan.mjs`, and
publishes only the release-recorded public packages with provenance. It must not use long-lived npm
tokens or create GitHub releases.

The release workflow requires npm Trusted Publisher ownership configured for the
`0disoft/mcp-security-proxy` repository, the package manifests are approved for public package
posture, and an approved release readiness record names the reachable target commit and exact
validation evidence.

The first-package bootstrap path is not a GitHub Actions workflow. Its source of truth is
`docs/ops/npm-bootstrap.md`; it keeps credentials in an interactive npm owner session and produces
only ignored, checksummed staging artifacts. CI validates the blocked/approved/completed plan shape
offline, dry-runs the staged bootstrap tarballs on the hosted runner, and rejects any bootstrap token
path added to the normal release workflow.

## Validation

- Required validation names: typecheck, test, contract, docs, schema-contract, migration-check,
  package-surface, secret-scan, artifact-safety, repository-hygiene, validation-registry, ci-contract,
  compatibility, license-report, release-readiness, performance-smoke, check.
- Release blocker status: public behavior changes are blocked when local `check` or hosted CI fails.
- Remaining operational risk: hosted CI covers one Ubuntu runner; future OS-specific proxy behavior
  still needs targeted validation before release.
