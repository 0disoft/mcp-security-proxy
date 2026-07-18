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
stdout, and writes JSON Lines audit events to the selected profile's `audit.path`. An explicit
`--audit-log` overrides that path.
When `--ops-log` is supplied, the command also writes structured JSON Lines lifecycle metrics to
that file. Ops events are diagnostic and do not replace audit events.
Upstream stderr is not relayed to stdout or copied into audit logs; the runtime records only a
redacted stderr line-count summary.

Required inputs:

- policy path
- profile name
- `--` separator followed by the upstream server command
- profile with a file audit destination and path

Optional inputs:

- audit output path override
- `--shutdown-grace-ms <0..2147483647>` controls how long `run` waits after client input closes
  before terminating the upstream process tree. The default is 1000 ms. Managed shutdown uses a
  POSIX process group or Windows `taskkill.exe /T`, then escalates to forced termination.
- `--max-frame-bytes <1..16777216>` controls the maximum UTF-8 byte length of one JSON-RPC line.
  The default is 1048576 bytes.
- `--max-json-depth <1..256>` controls the maximum parsed JSON nesting depth. The default is 64.
- `--ops-log <path>` writes optional lifecycle and bounded counter events as JSON Lines.

On Windows, `run` resolves the operating system's absolute Windows PowerShell path instead of using
`PATH`, starts a non-interactive guardian with a minimal environment, and establishes a nested Job
Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` before spawning the upstream command. The guardian
receives only the proxy PID, never the upstream argv or policy contents. If the guardian cannot
start, compile its fixed Win32 binding, or assign the proxy to the Job, `run` fails with exit code 4
before starting the upstream. Abrupt proxy termination then closes the last Job handle through the
guardian and reclaims the upstream tree. POSIX process groups still require an external supervisor
for equivalent parent-death cleanup.

### `mcp-security-proxy config-snippet`

Implemented as a read-only host configuration generator. The command requires a supported
`--target`, a valid policy path and existing profile, and an explicit `--` separator before the
upstream command. It emits exactly one JSON object with `command` and `args` fields. Arguments remain
an array so spaces, quotes, and Windows paths are not reconstructed through a shell string.

`--proxy-command <path>` selects the proxy executable stored in the output and defaults to
`mcp-security-proxy`. The command reads the policy only to validate it and confirm the profile. It
does not emit policy contents, inspect environment values, start a process, or modify policy and
host configuration files. Control characters in generated values are rejected. Supplied upstream
arguments are reproduced verbatim, so users must not put credentials or secret values in argv.

`--target codex-cli-json` additionally requires `--name <server>` and wraps the proxy descriptor as
`codex mcp add <server> -- <proxy> [args...]`. `--codex-command <path>` selects the Codex executable
stored in that descriptor and defaults to `codex`. Generation does not execute Codex or modify
`CODEX_HOME`; the descriptor changes Codex configuration only if a user explicitly runs it.

`--target gemini-cli-json` requires an underscore-free `--name <server>` and emits project-scoped
stdio `gemini mcp add` argv. `--gemini-command <path>` selects the executable and defaults to
`gemini`. The doubled `--` at the nested upstream boundary is intentional: Gemini consumes one
separator while storing the second as part of the proxy argv. Generation never writes
`.gemini/settings.json` and never enables Gemini's `--trust` option.

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
- `--target` selects `stdio-json`, `codex-cli-json`, or `gemini-cli-json` output.
- `--name` supplies the safe MCP server name required by host-specific targets.
- `--proxy-command` selects the proxy executable referenced by `config-snippet` without invoking it.
- `--codex-command` selects the Codex executable referenced by `codex-cli-json` without invoking it.
- `--gemini-command` selects the Gemini executable referenced by `gemini-cli-json` without invoking it.
- `--approval-hook` marks approval hook availability for dry-run call evaluation.
- `--audit-log` optionally overrides the selected profile's JSON Lines audit file for live proxy
  behavior. CLI `run` rejects profiles configured with `audit.destination: stdout`.
- `--ops-log` selects optional JSON Lines operational metrics output for live proxy behavior.
- `--shutdown-grace-ms` selects the live proxy shutdown grace window in milliseconds.
- `--max-frame-bytes` and `--max-json-depth` select live proxy frame guards.

`run` does not support `--json` because stdout is reserved for MCP protocol messages after the live
proxy starts. `run --help` exits before startup and may print usage text to stdout.
The upstream command must appear after an explicit `--` separator so CLI flags and upstream argv
cannot be confused.
`config-snippet` also requires that separator and preserves every upstream argument as a distinct
JSON array entry. It does not accept `--json` because its successful output is already the exact
JSON descriptor.
The CLI `run` command does not support `--approval-hook` because it does not bundle host approval
UX. Approval hooks belong to embedding hosts that call the runtime library. The `eval-call`
command may still use `--approval-hook` to dry-run how a call would classify when a hook is
available.

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
