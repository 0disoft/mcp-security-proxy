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
pnpm run check
```

`pnpm run check` runs:

- workspace TypeScript typecheck
- workspace tests
- contract checks for contracts and core
- documentation contract check
- schema contract checks
- package surface, tracked-file secret scans, public artifact safety checks, validation registry
  checks, CI contract checks, compatibility evidence checks, dependency license report checks,
  release-readiness preflight checks, and performance smoke checks
- CLI smoke checks against the local fixture policy

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

## Validation

- Required validation names: typecheck, test, contract, docs, schema-contract, package-surface,
  secret-scan, artifact-safety, validation-registry, ci-contract, compatibility, license-report,
  release-readiness, performance-smoke, check.
- Release blocker status: public behavior changes are blocked when local `check` or hosted CI fails.
- Remaining operational risk: hosted CI covers one Ubuntu runner; future OS-specific proxy behavior
  still needs targeted validation before release.
