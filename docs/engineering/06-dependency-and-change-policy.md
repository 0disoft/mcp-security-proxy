# Dependency and Change Policy

Status: Draft

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0003-open-source-license-and-private-data-boundary.md

## Dependency Rules

- Add dependencies only when they remove clear implementation risk or maintenance burden.
- Keep core policy logic independent from SDK, filesystem, subprocess, and network dependencies.
- Keep every workspace package manifest free of MCP SDK dependencies in all dependency groups, as
  required by docs/adr/0008-runtime-mcp-sdk-boundary.md.
- Pin and review dependency licenses before the first release.
- Treat MCP SDK, runtime, parser, and release-tool dependencies as compatibility-sensitive.
- Re-check dependency licenses from the installed lockfile graph, not from memory or package
  marketing text.
- `pnpm run license-report` must pass before public release.

## License Policy

- Project license: Apache-2.0.
- Allowed by default: Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, ISC.
- Review required: MPL-2.0, BlueOak-1.0.0, Unicode, dual-licensed packages, generated schema or
  parser assets.
- Denied by default: GPL, AGPL, LGPL, SSPL, BUSL, proprietary or source-available-only licenses.

Any exception must be documented before release.

## Current Dependency Review

- `typescript`: dev dependency, Apache-2.0.
- `@types/node`: dev dependency, MIT.
- `vitest`: dev dependency, MIT.
- MCP SDK packages: prohibited in workspace manifests. Exact SDK versions may exist only in ignored
  temporary external-compatibility environments and do not become product dependency approvals.
- `@microsoft/api-extractor`: pinned dev dependency, MIT, used only to generate and verify tracked
  public API reports. It is not included in published package runtime dependencies or artifacts.
- `minimatch@10.2.3`: transitive dev dependency through `@microsoft/api-extractor`,
  BlueOak-1.0.0, reviewed as acceptable for local and CI API-report generation. Re-review before
  release if it enters runtime dependencies or distributed artifacts.
- `lightningcss` and `lightningcss-win32-x64-msvc`: transitive dev dependencies through the test
  toolchain, MPL-2.0, reviewed as acceptable for local development tooling. Re-review before release
  if these enter runtime or distributed artifacts.
- The automated license report scans installed external package manifests under `node_modules/.pnpm`
  and fails on missing, unknown, or denied license metadata.

## Change Policy

- Policy schema, audit schema, CLI JSON output, decision semantics, and public API changes require
  semver and migration review.
- Dependency upgrades that affect MCP protocol behavior require compatibility fixtures.
- Release artifacts must not include real audit logs, real policy files, private captures, or
  exploit corpus data.

## Review Blockers

- A dependency license is unknown, incompatible, or checked only from an unstated source.
- `pnpm run license-report` fails.
- A workspace package declares an MCP SDK contrary to ADR 0008.
- Core policy logic imports runtime IO or SDK dependencies.
- A protocol dependency changes without fixture updates.
- A change weakens validation or hides skipped checks.
