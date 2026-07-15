# Codex Configuration Compatibility Evidence

Status: Draft

## Scope

This evidence covers read-only generation and isolated registration of one local stdio MCP server
with `@openai/codex@0.144.4`. It does not cover a live authenticated Codex session, tool execution,
approval UX, HTTP MCP, or other Codex versions.

## Recorded Evidence

- Decision: docs/adr/0009-codex-config-adapter.md
- Generator fixture: fixtures/compatibility/cli-config-snippet.codex-cli-json.json
- Host result: fixtures/compatibility/codex-cli-config.summary.json
- Harness: scripts/check-codex-config-fixture.mjs
- Validation: `node scripts/check-codex-config-fixture.mjs`

The harness installs the exact public Codex package into a temporary directory with empty npm user
and global configuration files and registry credential variables cleared. It creates a separate
temporary `CODEX_HOME`, runs the generated `codex mcp add` argv, reads the result through `codex mcp
get --json`, normalizes temporary paths, and deletes all temporary state.

## Proven Contract

- Codex accepts the generated server name.
- The registered transport is stdio.
- The proxy executable and each nested argument are preserved exactly.
- Spaces and path-like arguments remain separate argv entries.
- No real Codex home, authentication state, policy contents, environment values, or audit logs are
  captured.

## Remaining Risk

Codex CLI configuration can change after the pinned version. Public npm availability is required
when the external compatibility aggregate runs. Configuration acceptance does not prove that a
future authenticated Codex session initializes the upstream server or presents a safe approval UX.
