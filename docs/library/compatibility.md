# Compatibility

Status: Draft
Repository Type: library

## Repository Type Contract

This repository type owns public API surface, package compatibility, semantic versioning, migration guidance, distribution artifacts, and consumer-facing deprecation policy.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Public API ownership: docs/library/public-api.md
- Semantic versioning policy: docs/library/semver.md
- Runtime and platform compatibility: TypeScript, pnpm, and Node.js `>=24.0.0` for the current
  scaffold.
- Package artifact and export surface: private workspace packages only; public registry artifacts
  remain UNDECIDED.
- Deprecation and migration policy: docs/library/migration-guide.md

## Compatibility Targets

- MCP stdio transport first.
- HTTP transport planning is documented in docs/architecture/07-http-transport-plan.md, but HTTP is
  not implemented.
- TypeScript project references and pnpm workspace checks are the current local compatibility
  baseline.
- Node.js `>=24.0.0` is the current package manifest floor and must stay consistent across the
  workspace until a release readiness record changes it.
- HTTP transport support is deferred until stdio behavior is proven and HTTP-specific compatibility
  fixtures exist.
- Client compatibility must be fixture-backed, not claimed from schema reading alone.
- Policy and audit schemas must remain deterministic across supported runtimes.
- Public registry compatibility is not claimed while all packages remain private.

## Compatibility Evidence Required

- Captured MCP discovery fixture.
- Captured allowed call fixture.
- Captured denied call fixture.
- Captured approval-required call fixture.
- Captured matcher-denial fixtures for ambiguous paths, ambiguous network targets, and free-form
  shell commands.
- Captured network allow and deny fixtures.
- Captured secret-sensitive allow and denial fixtures that use labels only and contain no raw secret
  value.
- Captured redaction fixture.
- CLI JSON output fixture.
- Library decision-result fixture.
- Runtime live stdio smoke command evidence for the implemented local proxy path.
- Runtime session-result fixture for approval timeout fail-closed behavior.

The current evidence registry is `fixtures/compatibility/manifest.json`. `pnpm run compatibility`
builds the workspace, verifies every manifest entry, compares the captured CLI, library, and
runtime session fixtures against the current implementation, and runs registered runtime smoke
evidence commands.
Approval-required library fixtures may explicitly record `approvalHookAvailable` in the manifest so
hook-present and hook-missing decisions are both checked.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
- Package manifest compatibility drifts from `docs/library/package-surface.md`.
- `pnpm run compatibility` fails.
