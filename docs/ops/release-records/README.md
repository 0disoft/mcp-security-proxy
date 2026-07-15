# Release Records

Status: Draft

This directory stores public release readiness records.

No public package release is approved until a `*.release.json` record exists, `pnpm run check`
passes, and the release record captures the exact validation evidence required by
`scripts/check-release-readiness.mjs`. Before that point, package manifests must stay private and
versioned as `0.0.0`. Proposed or blocked records do not unlock public package posture; only an
approved release record may do that. Proposed or blocked records may name a future release version,
but package manifests must remain at `0.0.0` until approval. Approved records must not use
`0.0.0` as the release version. If `targetCommit` is recorded, it must be a full 40-character Git
commit SHA. Approved records must record `targetCommit`, and that value must be reachable from the
current repository HEAD so historical approved records remain verifiable after later commits.

The one-time npm package-name initialization is not a normal release record. It is controlled by
`docs/ops/npm-bootstrap-plan.json` and `docs/ops/npm-bootstrap.md`, keeps source manifests private,
uses `0.0.0-bootstrap.0` under the `bootstrap` dist-tag, and must not create a Git tag or add a
token path to the normal release workflow. npm may temporarily point `latest` at the only published
bootstrap version; the first OIDC product release must displace it before bootstrap completion.

Release records must include validation evidence for: `docs`, `schema-contract`,
`migration-check`, `package-surface`, `secret-scan`, `artifact-safety`, `repository-hygiene`,
`validation-registry`, `ci-contract`, `compatibility`, `license-report`, `release-readiness`,
`performance-smoke`, `contract`, `test`, `smoke`, and `check`.
`registry-smoke` is deliberately absent from release approval evidence because it can run only
after an immutable version exists on public npm. The release workflow and the manual Registry Smoke
workflow record that post-publication evidence separately; failure invokes rollback and package
deprecation rather than approval of the already-published artifact.
Tracked post-publication receipts live under `docs/ops/publications/` and must reference, not
rewrite, the approved release record.
For `approved` release records, each validation evidence value must include the executed command
and `exit 0`; for example, `pnpm run docs exit 0` or `pnpm check exit 0`.
For `approved` release records, `rollback.procedure` must be a safe tracked `docs/ops` path and
`rollback.lastKnownGoodVersion` must not equal the release version being approved.

Release records must also name whether MCP SDK dependency usage, HTTP transport support,
host-specific approval UX, and external MCP compatibility fixtures are included or excluded from
the release scope, with evidence for each scope decision. Scope evidence values must be safe
repository-relative paths to tracked decision, architecture, or operational files. Do not imply
HTTP, hosted control plane, bundled approval UI, SDK compatibility support, or external MCP
client/server compatibility through package names or release notes when the release record excludes
it. When a scope is `excluded`, its current exclusion or planning document may be used as evidence.
When a scope is `included`, the release record must use different tracked evidence that proves the
implementation, approval decision, fixture coverage, or operational support for that included
scope.

The required release scope keys are `mcpSdkDependency`, `httpTransport`, `hostApprovalUx`, and
`externalMcpFixture`.

Use `docs/adr/0008-runtime-mcp-sdk-boundary.md` for future records whose
`mcpSdkDependency.status` is `excluded`. Historical records may retain ADR 0004 as their exclusion
evidence. An included SDK scope requires a superseding ADR, an isolated adapter boundary, dependency
review, public API evidence, compatibility fixtures, and release validation; the existing SDK-free
ADR cannot be used as inclusion evidence.

Use `docs/architecture/09-external-mcp-compatibility-plan.md` as the release-scope evidence when
external MCP client/server fixtures are excluded. A release that includes them must replace that
exclusion with tracked fixture and validation evidence. `fixtures/compatibility/manifest.json`
must record external MCP evidence as a separate `targets[]` entry, not as the top-level
`local-stdio-mvp` evidence corpus. Target registration alone does not include external MCP
compatibility in a release; the release record must use non-exclusion evidence and approval-grade
validation output before `externalMcpFixture.status` may be `included`. For the first pinned
external filesystem stdio target, use `docs/ops/external-mcp-compatibility-evidence.md` as the
non-exclusion evidence source only after the required validation evidence is recorded.

Use `docs/architecture/07-http-transport-plan.md` as the release-scope evidence when HTTP
transport support is excluded. A release that includes HTTP transport must replace that exclusion
with tracked implementation, ADR, fixture, and validation evidence. While every target in
`fixtures/compatibility/manifest.json` records `transport: "stdio"`, `httpTransport.status` must
remain `excluded`.

Use `public-release.template.json` as the starting shape. Do not put credentials, tokens, private
audit logs, private policy files, or raw incident evidence in release records. Release artifact
`source` paths must be safe repository-relative paths. For current-target release records, artifact
`source` paths must point at tracked repository files so release recovery does not depend on local,
untracked state. Historical approved records may keep safe artifact source paths that no longer
exist at current HEAD. Each `publicPackages[].artifactName` must be unique and must match an entry
in `artifacts[].name`.
