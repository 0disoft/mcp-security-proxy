# Disaster Recovery

Status: Draft

## Operational Contract

Disaster recovery currently means recovering the repository, package distribution state, and local
operator usage after a severe release or security regression. There is no hosted runtime, database,
or multi-region service to fail over.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: SECURITY.md for security disasters; repository issues for non-sensitive release
  recovery

## Disaster Scenarios

- Public package or fixture leaks sensitive data.
- Public release weakens deny-by-default behavior or approval gating.
- CLI live `run` corrupts stdout MCP framing.
- Package artifacts become unreproducible from repository source.

## Recovery Steps

1. Stop distribution of the affected artifact or guidance.
2. Restore the last known-good commit or package.
3. Preserve redacted evidence only.
4. Run `pnpm run check`, `git diff --check`, package-surface validation, release-readiness
   validation, and the relevant smoke scenario.
5. Publish migration or remediation notes before resuming release work.

## Validation

- Required validation names: docs, package-surface, release-readiness, smoke, check.
- Release blocker status: public release is blocked when recovery cannot be proven from tracked
  source and documented validation.
- Remaining operational risk: no automated package deprecation, advisory publication, or artifact
  revocation workflow exists yet.
