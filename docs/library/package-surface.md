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
- Package artifact and export surface: the published `0.2.0-alpha.4` record names five
  public npm packages.
- Deprecation and migration policy: docs/library/migration-guide.md

## Current Package Posture

The root workspace and testkit remain private. The five release-recorded packages are published at
`0.2.0-alpha.4` while preserving workspace ownership and internal imports.

Until release readiness approves the recorded public package names and artifacts:

- the root workspace and every `packages/*` manifest must keep `private: true`;
- `pnpm-workspace.yaml` must include only the `packages/*` workspace package glob;
- versions must remain `0.0.0`;
- package names must stay under `@0disoft/mcp-security-proxy-*`;
- Node.js compatibility must stay `>=24.0.0`;
- package entrypoints must expose `./dist/index.d.ts` types and `./dist/index.js` runtime output;
- every package must keep `src/index.ts`, `tsconfig.json`, `tsconfig.build.json`, `build`, and
  `typecheck` ownership aligned with the exported entrypoint;
- the workspace typecheck must build dependency-ordered declaration entrypoints before checking
  workspace imports so clean checkouts do not depend on stale ignored `dist` output;
- package tarballs must contain only `dist`, package metadata, README, LICENSE, and the contracts
  package's versioned JSON schemas;
- every package build must compile with `tsconfig.build.json`, which excludes `src/**/*.test.ts`
  from emitted `dist/` artifacts while `typecheck` continues to validate the full `tsconfig.json`
  source set;
- the CLI package must keep the `mcp-security-proxy` bin pointing at `./dist/main.js` and the
  matching `src/main.ts` source entrypoint;
- the root workspace must not declare runtime, peer, or optional dependencies until release
  readiness records external runtime dependencies;
- runtime package dependencies must stay within this pnpm workspace and use `workspace:*` unless
  an exact external dependency is recorded in `docs/ops/external-runtime-dependencies.json` with
  accepted ADR evidence;
- every workspace dependency group must remain free of MCP SDK packages under ADR 0008; isolated
  external compatibility fixture installs are not workspace dependencies.

`pnpm run package-surface` enforces this private package posture until an approved release record
exists. When `docs/ops/release-records/*.release.json` records a package as public with
`status: "approved"` and a `targetCommit` reachable from the current HEAD, the same check allows
only that recorded `packages/*` manifest to use the recorded release version and public package
posture. When multiple historical approvals name the same package, only the approval whose target
commit is the latest descendant on one linear history owns the current manifest version. Conflicting
versions at the same target and approvals on incomparable histories fail validation. Unreachable
approved release records do not unlock current package manifests. Packages not listed in a
reachable approved release record must remain private and versioned as `0.0.0`.
The same validation builds and packs the five release-recorded package candidates, rejects source,
test, config, and undeclared artifact paths, checks that pnpm rewrites `workspace:*` dependencies,
installs the tarballs into a clean offline npm consumer, resolves ESM and TypeScript declarations,
using the workspace's supported Node 24 type baseline, and executes the installed CLI help path.
This validates package shape without publishing it.

`pnpm run registry-smoke -- --version <exact-semver>` is the separate post-publication check. It
downloads the five exact versions from public npm, verifies registry integrity and provenance
metadata, and applies the same ESM, TypeScript, and CLI consumer contract. It then uses the
registry-installed CLI, exact pinned MCP SDK, and exact pinned filesystem server for an actual
stdio onboarding session with filtered discovery, allowed and denied reads, orderly shutdown, and
redacted audit evidence. The same session starts with ops metrics disabled, hot-reloads the stable
feature flag, applies and rejects atomic policy replacements, proves last-known-good retention, and
checks bounded ops evidence without raw policy or feature-flag details. It is intentionally not
part of the offline `check` aggregate and does not accept `latest`, ranges, or unpublished versions.

## Expected Package Surfaces

- `packages/contracts`: policy, decision, audit event, ops event types, and JSON schema files.
- `packages/core`: method policy, classifier, evaluator, redactor, and audit formatter.
- `packages/mcp-adapter`: JSON-RPC envelope and method-policy adapter helpers.
- `packages/proxy-runtime`: runtime startup planning, JSON-RPC message gating, discovery
  filtering, and stdio subprocess bridge ownership.
- `packages/cli`: command registry, dry-run commands, and live stdio `run` entrypoint.
- `packages/testkit`: synthetic fixtures for future integration tests.

The publishable candidate set is contracts, core, mcp-adapter, proxy-runtime, and cli. Testkit is a
private workspace-only package and must not declare registry publication metadata.

The same five packages own API Extractor configurations under `packages/*/config/` and tracked
review baselines under `etc/api/`. `pnpm run api-report` verifies that built declarations match
those baselines. Testkit is excluded because it is private and is not part of the registry contract.
The reports are generated review inputs, not package contents or source-of-truth declarations.

## External Runtime Dependencies

Published workspace packages default to workspace-only runtime dependencies. The CLI's exact
OpenFeature dependencies are the first accepted exception and are recorded in
`docs/ops/external-runtime-dependencies.json` with ADR 0013 evidence. `package-surface` requires an
exact version match and rejects missing, duplicate, ranged, or unused decisions. Historical release
records remain immutable evidence of the dependencies that were actually published in those
versions.

## Expected Entrypoint Re-exports

- `packages/contracts/src/index.ts`: `./policy.js`, `./decision.js`, `./audit.js`,
  `./ops.js`, `./validation.js`.
- `packages/core/src/index.ts`: `./method-policy.js`, `./matchers.js`, `./classifier.js`,
  `./evaluator.js`, `./redactor.js`, `./audit.js`.
- `packages/mcp-adapter/src/index.ts`: `./jsonrpc.js`, `./method-policy.js`, `./tool-call.js`.
- `packages/proxy-runtime/src/index.ts`: `./startup-plan.js`, `./audit-correlation.js`, `./session.js`,
  `./stdio-bridge.js`.
- `packages/cli/src/index.ts`: `./commands.js`.
- `packages/testkit/src/index.ts`: `./fixtures.js`.

## Package Surface Rules

- Do not export unstable internal parser details as public API.
- Do not bundle generated audit logs or example secrets.
- Keep CLI output examples synchronized with docs/cli/output-and-exit-codes.md.
- Keep policy and audit schemas discoverable from package documentation.
- Keep packages private until release readiness approves the recorded public package names and
  artifacts.
- Keep MCP SDKs out of all workspace package manifests and published artifacts.
- Keep every non-workspace runtime dependency pinned to its machine-readable decision and accepted
  ADR.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Published-package claims lack exact-version registry smoke evidence.
- Package artifacts drift from documented public API.
- `pnpm run package-surface` fails.
- `pnpm run api-report` fails or its baseline changes without semver review.
- A workspace package declares or publishes an MCP SDK dependency.
