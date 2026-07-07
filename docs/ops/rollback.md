# Rollback

Status: Draft

## Operational Contract

Rollback is currently package, commit, and local configuration rollback. There is no project-owned
database, migration stream, hosted deployment, or remote control plane to roll back.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive rollback defects; SECURITY.md for rollback
  failures that expose sensitive data

## Decision Tree

- If a policy file causes over-broad access, stop the proxy and restore the last known-good local
  policy file.
- If a CLI/library release causes policy bypass, audit leakage, protocol corruption, or startup
  failure, stop distributing that version and pin consumers to the last known-good commit or
  package.
- If a public fixture or doc leaks sensitive material, remove the artifact, rotate affected secrets
  at their source, and add a regression check before redistributing.
- If upstream MCP server behavior changes, prefer a compatibility fix or policy update over
  broadening passthrough.

## Procedure

1. Stop the affected proxy process or package distribution path.
2. Capture redacted reproduction evidence.
3. Restore the last known-good policy file, commit, or package version.
4. Run `pnpm run check`, `git diff --check`, and the relevant smoke scenario.
5. Document the forward fix and any migration notes.

## Pinning Guidance

- Before a public package release exists, consumers should pin a Git commit SHA or local workspace
  revision.
- After a public package release exists, the release record must name the package version and the
  rollback package version.
- Bad package releases must be handled by publishing a fixed version or deprecating the bad version
  in the registry named by the release record. Do not silently reuse a published version number.

## Database Rollback Policy

No project-owned database exists. Local audit logs are append-only operator-owned evidence; do not
rewrite them as part of rollback unless the operator is removing sensitive local data under their
own retention policy.

## Validation

- Required validation names: docs, artifact-safety, repository-hygiene, validation-registry,
  ci-contract, release-readiness, smoke, check.
- Release blocker status: public release is blocked when rollback path, validation output, or
  package pinning guidance is missing.
- Remaining operational risk: no automated package unpublish/deprecate workflow exists yet.
