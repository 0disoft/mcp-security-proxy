# CLI Configuration

Status: Draft
Repository Type: cli-tool

## Repository Type Contract

This repository type owns command behavior, arguments, flags, config loading, exit codes, terminal output, JSON output, runtime compatibility, and shell integration contracts.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Configuration Inputs

- Policy file path
- Server profile name
- Upstream stdio server command after `--`
- Audit output file path
- Optional ops metrics output file path
- Optional ops-only OpenFeature snapshot path
- Optional shutdown grace window in milliseconds
- Optional frame byte and JSON depth limits for live MCP stdio messages
- Optional dry-run input file
- Optional JSON output flag for non-`run` commands
- Read-only `config-snippet` target and optional proxy executable path

## Precedence

CLI flags select runtime paths and profile names. Policy files own security decisions. Environment
variables may provide convenience defaults only when they do not contain secrets and are documented.

Proposed precedence:

1. Explicit CLI flags
2. Profile values inside the policy file
3. Documented environment defaults
4. Built-in safe defaults

## Safe Defaults

- Default action: deny
- Audit content capture: summary only; `includeRawArguments` and `includeFullPaths` must both be
  `false` in the current schema.
- Redaction: enabled
- Unknown capability: deny
- Shell command matching: exact argv length; `*` matches one argument at its position and all other
  entries match exactly
- CLI `run` stdout: MCP protocol messages only
- CLI `run` audit output: JSON Lines file from the selected profile's `audit.path`, optionally
  overridden by `--audit-log`. CLI `run` rejects `audit.destination: stdout`.
- CLI `run` ops output: optional JSON Lines file selected by `--ops-log`
- CLI `run` ops feature snapshot: optional file selected by `--ops-feature-flags`; the
  `mcp.ops.metrics.enabled` key defaults to enabled and controls only ops event writes
- CLI `run` shutdown grace: 1000 ms unless `--shutdown-grace-ms` supplies an integer between
  0 and 2147483647
- CLI `run` managed shutdown targets the upstream process tree, not only the immediate child.
- CLI `run` frame size: 1048576 bytes unless `--max-frame-bytes` supplies an integer between
  1 and 16777216
- CLI `run` JSON depth: 64 unless `--max-json-depth` supplies an integer between 1 and 256
- CLI `config-snippet` target: explicit `stdio-json`, `codex-cli-json`, or `gemini-cli-json`; output contains only a
  command and argv array and never writes a host configuration file

## Generated Configuration

`config-snippet` validates the selected policy and profile before emitting a descriptor. It keeps
the supplied policy path, profile, proxy executable, upstream command, and upstream arguments
verbatim except for rejecting control characters. It does not resolve paths, read environment
variables, copy policy contents, or infer shell quoting. Consumers remain responsible for placing
the descriptor in the correct host configuration location. Because upstream argv is reproduced
verbatim, credentials and secret values must not be supplied as command-line arguments.

The Codex target requires a server name containing only 1..64 ASCII letters, numbers, hyphens, or
underscores. It emits `codex mcp add` argv and does not read, merge, or write Codex TOML. Running the
generated command is a separate explicit user action that changes the active `CODEX_HOME`.

The Gemini target requires an underscore-free server name and emits project-scoped stdio
registration argv. It never emits `--trust` or writes `.gemini/settings.json`. Its doubled nested
separator is required so Gemini stores the proxy's own upstream separator after parsing.

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
