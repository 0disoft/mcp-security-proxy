# Gemini CLI Configuration Compatibility Evidence

Status: Draft

## Scope

This evidence covers read-only generation and isolated project-scoped registration of one local
stdio MCP server with `@google/gemini-cli@0.50.0`. It does not cover authentication, live tool use,
workspace trust, approval UX, remote transports, or other Gemini CLI versions.

## Recorded Evidence

- Decision: docs/adr/0010-gemini-config-adapter.md
- Generator fixture: fixtures/compatibility/cli-config-snippet.gemini-cli-json.json
- Host result: fixtures/compatibility/gemini-cli-config.summary.json
- Harness: scripts/check-gemini-config-fixture.mjs
- Validation: `node scripts/check-gemini-config-fixture.mjs`

The harness installs the exact public Apache-2.0 Gemini CLI package into a temporary directory with
empty npm configuration files and registry credential variables cleared. It uses a temporary home
and project, runs the generated descriptor, verifies `.gemini/settings.json`, normalizes temporary
paths, and deletes all temporary state.

## Proven Contract

- Gemini accepts the generated server name and project-scoped stdio registration.
- The proxy executable and every nested argument are preserved exactly.
- Gemini consumes one parser separator while retaining the proxy's upstream separator.
- No real home, authentication state, policy contents, environment values, or audit logs are read.

## Remaining Risk

Gemini CLI configuration behavior can change after the pinned version and the external aggregate
requires public npm availability. Configuration acceptance does not prove a future authenticated
session initializes the server or presents a safe approval flow.
