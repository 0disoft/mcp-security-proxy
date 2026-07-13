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
- Optional shutdown grace window in milliseconds
- Optional frame byte and JSON depth limits for live MCP stdio messages
- Optional dry-run input file
- Optional JSON output flag for non-`run` commands

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
- Shell command matching: exact or narrow argv pattern only
- CLI `run` stdout: MCP protocol messages only
- CLI `run` audit output: JSON Lines file from the selected profile's `audit.path`, optionally
  overridden by `--audit-log`. CLI `run` rejects `audit.destination: stdout`.
- CLI `run` ops output: optional JSON Lines file selected by `--ops-log`
- CLI `run` shutdown grace: 1000 ms unless `--shutdown-grace-ms` supplies an integer between
  0 and 2147483647
- CLI `run` frame size: 1048576 bytes unless `--max-frame-bytes` supplies an integer between
  1 and 16777216
- CLI `run` JSON depth: 64 unless `--max-json-depth` supplies an integer between 1 and 256

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
