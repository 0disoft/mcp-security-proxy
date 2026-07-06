# Command Contract

Status: Draft
Repository Type: cli-tool

## Repository Type Contract

This repository type owns command behavior, arguments, flags, config loading, exit codes, terminal output, JSON output, runtime compatibility, and shell integration contracts.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Command list and flag ownership: dry-run commands are implemented; live `run` remains deferred.
- Exit-code taxonomy: docs/cli/output-and-exit-codes.md
- Machine-readable output contract: JSON output must never include raw secret-bearing payloads.
- Config precedence and default behavior: explicit CLI flags override policy file paths and profile
  selection; policy decisions remain file-owned.
- Runtime compatibility floor: Node.js `>=24.0.0`.

## Provisional Commands

### `mcp-security-proxy run`

Reserved for running an MCP server behind the proxy. The pure runtime message gate now exists, but
the CLI command still does not spawn or pipe an upstream MCP process and exits with code 6.

Required inputs:

- policy path
- profile name
- upstream server command or endpoint
- audit output destination

### `mcp-security-proxy check-policy`

Implemented. Validates policy syntax, schema version, method policy, profiles, rules, audit
settings, and redaction settings without starting a server.

### `mcp-security-proxy inspect-tools`

Implemented for captured tool-list JSON files. Reports inferred capabilities, classifier evidence,
and whether the selected profile has covering policy rules.

### `mcp-security-proxy eval-call`

Implemented for captured normalized tool-call JSON files. Evaluates one call against policy and
prints the decision without forwarding it.

## Flag Principles

- `--json` returns machine-readable summaries only.
- `--policy` points to the local policy file.
- `--profile` selects the server policy profile.
- `--input` points to captured tool-list or tool-call JSON for dry-run commands.
- `--approval-hook` marks approval hook availability for dry-run call evaluation.
- `--audit-log` selects JSON Lines audit output for future live proxy behavior.
- `--dry-run` never forwards a tool call.

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
