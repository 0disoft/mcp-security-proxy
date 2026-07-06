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
- Package artifact and export surface: private pnpm workspace packages exist; public registry
  artifacts remain UNDECIDED.
- Deprecation and migration policy: docs/library/migration-guide.md

## Expected Package Surfaces

- `packages/contracts`: policy, decision, audit event types, and JSON schema files.
- `packages/core`: method policy, classifier, evaluator, redactor, and audit formatter.
- `packages/mcp-adapter`: JSON-RPC envelope and method-policy adapter helpers.
- `packages/proxy-runtime`: runtime startup planning and future stdio proxy ownership.
- `packages/cli`: command registry and future CLI entrypoint.
- `packages/testkit`: synthetic fixtures for future integration tests.

## Package Surface Rules

- Do not export unstable internal parser details as public API.
- Do not bundle generated audit logs or example secrets.
- Keep CLI output examples synchronized with docs/cli/output-and-exit-codes.md.
- Keep policy and audit schemas discoverable from package documentation.
- Keep packages private until release readiness records public package names and artifacts.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
