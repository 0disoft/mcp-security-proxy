# Semantic Versioning

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
- Semantic versioning policy: documented here and enforced after the first package release.
- Runtime and platform compatibility: docs/library/compatibility.md
- Package artifact and export surface: docs/library/package-surface.md
- Deprecation and migration policy: docs/library/migration-guide.md

## Versioned Surface

After the first public package release, semantic versioning covers:

- exported policy parser, validator, evaluator, classifier, redactor, audit, and MCP adapter types
- policy schema fields, defaults, matching behavior, and decision semantics
- audit event schema fields, redaction guarantees, and severity or decision labels
- decision evidence code values once documented as stable public values
- CLI-facing library helpers that shape command output or exit behavior
- package entrypoints, documented exports, and published schema assets

The following remain outside semver until explicitly documented as public:

- internal parser helpers
- fixture file layout
- generated documentation metadata
- private test utilities
- implementation-specific transport adapters that are marked experimental

## Breaking Changes

The following require a major version after the first public release:

- changing allow, deny, or approval-required decision semantics
- weakening deny-by-default behavior
- removing public exports or published schema files
- renaming policy schema fields without backward compatibility
- changing audit event meaning, redaction guarantees, or required fields
- removing or reusing an existing documented decision evidence code with a different meaning
- changing path, command, network, or secret matching behavior in a way that can allow previously
  denied calls or deny previously allowed calls
- raising the runtime compatibility floor

## Minor Changes

The following may be minor versions when backward compatible:

- adding optional policy schema fields with deny-by-default behavior
- adding public helper functions or public types
- adding audit fields that consumers may ignore safely
- adding new optional decision evidence codes for newly handled cases
- adding stricter validation warnings that do not change runtime decisions
- adding new classifier labels when unknown labels still deny by default

## Patch Changes

The following may be patch versions when behavior remains compatible:

- fixing policy parser bugs without changing documented valid input
- fixing redaction false negatives without exposing more data
- improving error messages without changing error identity
- fixing audit formatting defects while preserving schema meaning
- documentation and example corrections

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
- Policy or audit schema changes ship without a version impact note.
- A security-sensitive matcher changes without compatibility and migration review.
