# Dependency and Change Policy

Status: Draft

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0003-open-source-license-and-private-data-boundary.md

## Dependency Rules

- Add dependencies only when they remove clear implementation risk or maintenance burden.
- Keep core policy logic independent from SDK, filesystem, subprocess, and network dependencies.
- Pin and review dependency licenses before the first release.
- Treat MCP SDK, runtime, parser, and release-tool dependencies as compatibility-sensitive.
- Re-check dependency licenses from the lockfile, not from memory or package marketing text.

## License Policy

- Project license: Apache-2.0.
- Allowed by default: Apache-2.0, MIT, BSD-2-Clause, BSD-3-Clause, ISC.
- Review required: MPL-2.0, Unicode, dual-licensed packages, generated schema or parser assets.
- Denied by default: GPL, AGPL, LGPL, SSPL, BUSL, proprietary or source-available-only licenses.

Any exception must be documented before release.

## Current Dependency Review

- `typescript`: dev dependency, Apache-2.0.
- `@types/node`: dev dependency, MIT.
- `vitest`: dev dependency, MIT.
- `lightningcss` and `lightningcss-win32-x64-msvc`: transitive dev dependencies through the test
  toolchain, MPL-2.0, reviewed as acceptable for local development tooling. Re-review before release
  if these enter runtime or distributed artifacts.

## Change Policy

- Policy schema, audit schema, CLI JSON output, decision semantics, and public API changes require
  semver and migration review.
- Dependency upgrades that affect MCP protocol behavior require compatibility fixtures.
- Release artifacts must not include real audit logs, real policy files, private captures, or
  exploit corpus data.

## Review Blockers

- A dependency license is unknown, incompatible, or checked only from an unstated source.
- Core policy logic imports runtime IO or SDK dependencies without an ADR.
- A protocol dependency changes without fixture updates.
- A change weakens validation or hides skipped checks.
