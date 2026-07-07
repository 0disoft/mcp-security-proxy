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

- Command list and flag ownership: dry-run commands are implemented; live `run` starts an upstream
  stdio MCP process behind the runtime message gate.
- Exit-code taxonomy: docs/cli/output-and-exit-codes.md
- Machine-readable output contract: JSON output must never include raw secret-bearing payloads.
- Config precedence and default behavior: explicit CLI flags override policy file paths and profile
  selection; policy decisions remain file-owned.
- Runtime compatibility floor: Node.js `>=24.0.0`.

## Provisional Commands

### `mcp-security-proxy run`

Implemented for newline-delimited stdio MCP servers. The command starts the upstream process named
after `--`, gates client and upstream JSON-RPC lines through policy, writes only MCP messages to
stdout, and writes JSON Lines audit events to the file named by `--audit-log`.
Upstream stderr is not relayed to stdout or copied into audit logs; the runtime records only a
redacted stderr line-count summary.

Required inputs:

- policy path
- profile name
- `--` separator followed by the upstream server command
- audit output file path

Optional inputs:

- `--shutdown-grace-ms <0..2147483647>` controls how long `run` waits after client input closes
  before killing the upstream process. The default is 1000 ms.
- `--max-frame-bytes <1..16777216>` controls the maximum UTF-8 byte length of one JSON-RPC line.
  The default is 1048576 bytes.
- `--max-json-depth <1..256>` controls the maximum parsed JSON nesting depth. The default is 64.

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

- `--help`, `<command> --help`, and `help <command>` print CLI usage without loading policy files,
  starting upstream processes, or writing audit events.
- `--json` returns machine-readable summaries only.
- `--policy` points to the local policy file.
- `--profile` selects the server policy profile.
- `--input` points to captured tool-list or tool-call JSON for dry-run commands.
- `--approval-hook` marks approval hook availability for dry-run call evaluation.
- `--audit-log` selects JSON Lines audit output for live proxy behavior.
- `--shutdown-grace-ms` selects the live proxy shutdown grace window in milliseconds.
- `--max-frame-bytes` and `--max-json-depth` select live proxy frame guards.
- `--dry-run` never forwards a tool call.

`run` does not support `--json` because stdout is reserved for MCP protocol messages after the live
proxy starts. `run --help` exits before startup and may print usage text to stdout.
The upstream command must appear after an explicit `--` separator so CLI flags and upstream argv
cannot be confused.
The CLI `run` command does not support `--approval-hook` because it does not bundle host approval
UX. Approval hooks belong to embedding hosts that call the runtime library. The `eval-call`
command may still use `--approval-hook` to dry-run how a call would classify when a hook is
available.

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
