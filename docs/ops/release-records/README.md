# Release Records

Status: Draft

This directory stores public release readiness records.

No public package release is approved until a `*.release.json` record exists, `pnpm run check`
passes, and the release record captures the exact validation evidence required by
`scripts/check-release-readiness.mjs`. Before that point, package manifests must stay private and
versioned as `0.0.0`.

Release records must include validation evidence for: `docs`, `schema-contract`,
`migration-check`, `package-surface`, `secret-scan`, `artifact-safety`, `repository-hygiene`,
`validation-registry`, `ci-contract`, `compatibility`, `license-report`, `release-readiness`,
`performance-smoke`, `contract`, `test`, `smoke`, and `check`.

Use `public-release.template.json` as the starting shape. Do not put credentials, tokens, private
audit logs, private policy files, or raw incident evidence in release records.
