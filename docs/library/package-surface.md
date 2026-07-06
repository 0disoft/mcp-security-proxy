# Package Surface

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
- Runtime and platform compatibility: docs/library/compatibility.md
- Package artifact and export surface: UNDECIDED until implementation language and package manager are chosen.
- Deprecation and migration policy: docs/library/migration-guide.md

## Expected Package Surfaces

- CLI binary entrypoint, if the implementation language supports packaged executables.
- Library exports for policy, classifier, evaluator, redactor, audit, and MCP adapter types.
- Schema files or generated types for policy and audit event formats.
- Example deny-by-default policy.
- Test fixtures for discovery, allowed call, denied call, and redaction.

## Package Surface Rules

- Do not export unstable internal parser details as public API.
- Do not bundle generated audit logs or example secrets.
- Keep CLI output examples synchronized with docs/cli/output-and-exit-codes.md.
- Keep policy and audit schemas discoverable from package documentation.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
