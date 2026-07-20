# OpenFeature Ops Metrics Boundary

Status: Accepted
Owner: 0disoft

## Context

The long-running stdio proxy already emits an optional local JSON Lines operations stream. Operators
may need to pause that diagnostic stream without restarting the upstream MCP server, but feature
configuration must never become another authorization input. The policy file, runtime approval
hook, audit sink, protocol guards, and process containment remain the only owners of their existing
security decisions.

The stable `@0disoft/openfeature-local-provider@1.0.0` package supplies bounded local snapshot
loading, atomic in-memory replacement, cross-platform file watching, last-known-good behavior, and
OpenFeature configuration-change events. `@openfeature/server-sdk@1.22.0` supplies the provider
event contract. Both packages require Node versions compatible with the repository's Node 24
runtime floor and use Apache-2.0 licensing.

## Decision

The published CLI may declare these exact runtime dependencies:

- `@0disoft/openfeature-local-provider@1.0.0`;
- `@openfeature/server-sdk@1.22.0`.

The CLI option `--ops-feature-flags <path>` is valid only with `--ops-log`. It loads one local
snapshot before upstream startup and watches valid replacements while the proxy runs. Only the
boolean `mcp.ops.metrics.enabled` is evaluated. Missing keys use `true` so an existing `--ops-log`
invocation keeps its previous behavior.

The controller listens for OpenFeature `PROVIDER_CONFIGURATION_CHANGED`, caches the new boolean,
and keeps MCP processing free of file I/O. Invalid, unreadable, or semantically rejected
replacements leave the last valid value active. Diagnostics expose stable reason codes without the
snapshot path or contents. The watcher, event handler, and provider close with the proxy run.

This flag must not affect:

- policy parsing or replacement;
- discovery filtering or tool-call allow, deny, or approval decisions;
- audit event creation or audit failure behavior;
- JSON-RPC frame and depth guards;
- upstream startup, shutdown, or process containment.

The exact dependency decisions are machine-readable in
`docs/ops/external-runtime-dependencies.json`. `package-surface` rejects undeclared external runtime
dependencies, version ranges, missing ADR evidence, duplicate decisions, and unused decisions.

## Consequences

- Operators can hot-reload optional ops metric emission without restarting a live MCP session.
- The CLI artifact grows by the provider, OpenFeature SDK, and their transitive YAML dependency.
- The feature remains local-only; it adds no remote control plane, network fetch, credential, or
  telemetry backend.
- Future dependency changes require updating the exact decision record, compatibility evidence,
  lockfile, licenses, package consumer smoke, and this ADR or a superseding ADR.

## Rollback

Omit `--ops-feature-flags` to retain the prior always-on behavior for a configured `--ops-log`.
Removing the option also permits deleting the controller and both external runtime dependencies
without changing policy, audit, or protocol contracts.

## Review Blockers

- A feature flag changes any security or audit decision.
- Snapshot reload performs file I/O on the MCP message hot path.
- A failed replacement clears or disables the last valid value.
- Diagnostics expose snapshot paths, contents, or parser details.
- The provider or watcher remains active after proxy shutdown.
- An external runtime dependency is not pinned and recorded with evidence.
