# Release Records

Status: Draft

This directory stores public release readiness records.

No public package release is approved until a `*.release.json` record exists and `pnpm run
release-readiness` passes. Before that point, package manifests must stay private and versioned as
`0.0.0`.

Use `public-release.template.json` as the starting shape. Do not put credentials, tokens, private
audit logs, private policy files, or raw incident evidence in release records.
