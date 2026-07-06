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
- Runtime and platform compatibility: UNDECIDED.
- Package artifact and export surface: UNDECIDED.
- Deprecation and migration policy: docs/library/migration-guide.md

## Compatibility Targets

- MCP stdio transport first.
- HTTP transport support is deferred until stdio behavior is proven.
- Client compatibility must be fixture-backed, not claimed from schema reading alone.
- Policy and audit schemas must remain deterministic across supported runtimes.

## Compatibility Evidence Required

- Captured MCP discovery fixture.
- Captured allowed call fixture.
- Captured denied call fixture.
- Captured redaction fixture.
- CLI JSON output fixture.
- Library decision-result fixture.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
