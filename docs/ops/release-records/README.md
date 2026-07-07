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

Release records must also name whether MCP SDK dependency usage, HTTP transport support,
host-specific approval UX, and external MCP compatibility fixtures are included or excluded from
the release scope, with evidence for each scope decision. Scope evidence values must be safe
repository-relative paths to tracked decision, architecture, or operational files. Do not imply
HTTP, hosted control plane, bundled approval UI, SDK compatibility support, or external MCP
client/server compatibility through package names or release notes when the release record excludes
it.

The required release scope keys are `mcpSdkDependency`, `httpTransport`, `hostApprovalUx`, and
`externalMcpFixture`.

Use `docs/architecture/09-external-mcp-compatibility-plan.md` as the release-scope evidence when
external MCP client/server fixtures are excluded. A release that includes them must replace that
exclusion with tracked fixture and validation evidence.

Use `public-release.template.json` as the starting shape. Do not put credentials, tokens, private
audit logs, private policy files, or raw incident evidence in release records.
