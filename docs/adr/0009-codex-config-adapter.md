# Codex Configuration Adapter

Status: Accepted
Owner: 0disoft

## Context

The host-neutral `stdio-json` descriptor preserves the proxy command and argv but still leaves users
to translate it into a host-specific registration flow. Codex officially supports local stdio MCP
servers through `codex mcp add <name> -- <command> [args...]` and stores the resulting configuration
under `CODEX_HOME`. Directly editing Codex TOML would make this project responsible for merging user
configuration, escaping TOML, preserving comments, and tracking Codex schema changes.

Official contract: https://learn.chatgpt.com/docs/extend/mcp.md

## Decision

`config-snippet --target codex-cli-json` emits a read-only command descriptor for the official
`codex mcp add` flow. It requires a safe `--name`, validates the selected policy and profile, and
nests the complete proxy command and argv after Codex's explicit `--` separator.

The command does not execute Codex, read or write `CODEX_HOME`, merge `config.toml`, authenticate a
user, or claim host approval UX support. `--codex-command` may select the Codex executable recorded
in the descriptor and defaults to `codex`.

The compatibility harness pins `@openai/codex@0.144.4`, installs it without registry credentials,
sets a newly created temporary `CODEX_HOME`, executes the generated `mcp add` argv, and verifies the
registered server through `codex mcp get --json`. The temporary home and installation are removed
after every run.

## Security Boundary

- Server names are limited to 1..64 ASCII letters, numbers, hyphens, or underscores.
- Control characters are rejected from every generated command value.
- Policy contents, environment values, audit events, and Codex authentication state are not read or
  emitted.
- Upstream argv is reproduced verbatim and may be sensitive; credentials must not be passed there.
- The generated command mutates Codex configuration only if a user or automation explicitly runs
  it. Generation itself is read-only.

## Compatibility Scope

Evidence proves configuration acceptance for exactly `@openai/codex@0.144.4` and the recorded
stdio command shape. It does not prove arbitrary Codex versions, successful model authentication,
tool execution through a live Codex session, Codex approval UX integration, or compatibility with
other MCP hosts.

Updating the pinned Codex version requires reviewing official MCP configuration docs, regenerating
the normalized fixture, and running the complete compatibility and package consumer checks.

## Consequences

- Codex owns TOML serialization and merging through its public CLI.
- Users receive argv-safe registration instructions without this project modifying their files.
- Hosted and local CI gain an external host configuration compatibility dependency on the pinned
  Codex npm package and public npm availability.
- Host-specific approval UX remains excluded from release scope.

## Review Blockers

- The generator writes user Codex configuration directly.
- A fixture uses the real user `CODEX_HOME`, authentication state, or registry credentials.
- Documentation calls configuration acceptance full Codex runtime or approval UX support.
- The Codex package version changes without fixture, dependency, and official-contract review.
