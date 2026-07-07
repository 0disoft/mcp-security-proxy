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

## Current Package Posture

This repository is not ready for public npm publication. The current package boundary is a private
pnpm workspace used to validate implementation ownership and internal imports.

Until release readiness records public package names and artifacts:

- the root workspace and every `packages/*` manifest must keep `private: true`;
- versions must remain `0.0.0`;
- package names must stay under `@0disoft/mcp-security-proxy-*`;
- Node.js compatibility must stay `>=24.0.0`;
- package entrypoints must expose `./src/index.ts` types and `./dist/index.js` runtime output;
- every package must keep `src/index.ts`, `tsconfig.json`, `build`, and `typecheck` ownership
  aligned with the exported entrypoint;
- the CLI package must keep the `mcp-security-proxy` bin pointing at `./dist/main.js` and the
  matching `src/main.ts` source entrypoint;
- runtime package dependencies must stay within this pnpm workspace and use `workspace:*` until
  release readiness records external runtime dependencies.

`pnpm run package-surface` enforces this private package posture.

## Expected Package Surfaces

- `packages/contracts`: policy, decision, audit event types, and JSON schema files.
- `packages/core`: method policy, classifier, evaluator, redactor, and audit formatter.
- `packages/mcp-adapter`: JSON-RPC envelope and method-policy adapter helpers.
- `packages/proxy-runtime`: runtime startup planning, JSON-RPC message gating, discovery
  filtering, and stdio subprocess bridge ownership.
- `packages/cli`: command registry, dry-run commands, and live stdio `run` entrypoint.
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
- `pnpm run package-surface` fails.
