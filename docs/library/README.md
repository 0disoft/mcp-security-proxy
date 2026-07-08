# Library

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
- Approval hook API: docs/library/approval-hooks.md
- Stable decision evidence codes: docs/library/decision-codes.md
- Semantic versioning policy: docs/library/semver.md
- Runtime and platform compatibility: docs/library/compatibility.md
- Package artifact and export surface: docs/library/package-surface.md
- Deprecation and migration policy: docs/library/migration-guide.md

## Library Purpose

The library should let MCP hosts and local agent runners embed the same policy evaluation and audit
logic used by the CLI. It should keep protocol inspection, policy decisions, redaction, and audit
formatting separable so adopters can use only the pieces they need.

## Library Non-Goals

- Owning host process lifecycle
- Rendering approval UI
- Storing secrets
- Performing OS-level sandboxing
- Providing a full MCP server framework

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
