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

- Command list and flag ownership: provisional until implementation ADR, listed below.
- Exit-code taxonomy: docs/cli/output-and-exit-codes.md
- Machine-readable output contract: JSON output must never include raw secret-bearing payloads.
- Config precedence and default behavior: explicit CLI flags override policy file paths and profile
  selection; policy decisions remain file-owned.
- Runtime compatibility floor: UNDECIDED.

## Provisional Commands

### `mcp-security-proxy run`

Runs an MCP server behind the proxy.

Required inputs:

- policy path
- profile name
- upstream server command or endpoint
- audit output destination

### `mcp-security-proxy check-policy`

Validates policy syntax, schema, rule ordering, and redaction settings without starting a server.

### `mcp-security-proxy inspect-tools`

Reads a captured tool list or live server discovery response and reports inferred capabilities and
missing policy decisions.

### `mcp-security-proxy eval-call`

Evaluates one captured tool call against policy and prints the decision without forwarding it.

## Flag Principles

- `--json` returns machine-readable summaries only.
- `--policy` points to the local policy file.
- `--profile` selects the server policy profile.
- `--audit-log` selects JSON Lines audit output.
- `--dry-run` never forwards a tool call.

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
