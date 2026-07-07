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
- TypeScript project references and pnpm workspace checks are the current local compatibility
  baseline.
- Node.js `>=24.0.0` is the current package manifest floor and must stay consistent across the
  workspace until a release readiness record changes it.
- HTTP transport support is deferred until stdio behavior is proven.
- Client compatibility must be fixture-backed, not claimed from schema reading alone.
- Policy and audit schemas must remain deterministic across supported runtimes.
- Public registry compatibility is not claimed while all packages remain private.

## Compatibility Evidence Required

- Captured MCP discovery fixture.
- Captured allowed call fixture.
- Captured denied call fixture.
- Captured redaction fixture.
- CLI JSON output fixture.
- Library decision-result fixture.

The current evidence registry is `fixtures/compatibility/manifest.json`. `pnpm run compatibility`
builds the workspace, verifies every manifest entry, and compares the captured CLI and library
fixtures against the current implementation.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
- Package manifest compatibility drifts from `docs/library/package-surface.md`.
- `pnpm run compatibility` fails.
