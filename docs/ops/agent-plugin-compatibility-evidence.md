# Agent Plugins compatibility evidence

Status: installable self-contained demo
Checked: 2026-08-08

## Scope

This evidence covers the tracked `agent-plugin/` directory and live official Agent Plugins 1.0.0
schemas retrieved from `agent-plugins.org`. The live schemas still identify version 1.0.0 at the
time of this check.

## Result

- `plugin.json` and `mcp.json` declare the canonical official schema identifiers and pass live
  validation.
- `mcp.json` uses the standard `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` placeholders rather than
  repository-relative paths.
- `package.json` pins the published MCP Security Proxy CLI matching the plugin version.
- The package owns its deny-by-default policy and a side-effect-free `demo_status` MCP server.
- Runtime code and policy live under `${PLUGIN_ROOT}`; the redacted audit log is written under
  `${PLUGIN_DATA}`.
- No environment map, credential, token, raw secret, or host configuration write is included.

## Distribution boundary

The directory is an installable self-contained demo after its pinned npm dependency is installed.
It proves portable package layout and proxy mediation, but it is not a general production policy or
an endorsement of an arbitrary upstream MCP server.

Agent Plugins 1.0.0 standardizes packaging and discovery. It does not define marketplace
acceptance, host permissions, dependency installation, or runtime lifecycle. Those remain host and
deployment responsibilities.

## Validation

`pnpm run compatibility` builds the workspace and checks package paths, version parity,
deny-by-default policy, side-effect-free demo runtime, secret-free shape, and documented scope.
The `external-compatibility` validation retrieves the live official Agent Plugins 1.0.0 schemas and
validates the tracked manifests with JSON Schema 2020-12. It also installs a clean temporary copy
from `package-lock.json`, then checks initialization, filtered discovery, the allowed demo call,
clean shutdown, and audit output under `${PLUGIN_DATA}`.
