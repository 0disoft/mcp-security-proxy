# Config and Environment

Status: Draft

## Operational Contract

Configuration is a runtime contract. The current implementation uses explicit CLI flags, local
policy files, and safe defaults. Environment variables may be added later only for documented,
non-secret convenience defaults.

## Owners

- Primary owner: 0disoft
- Backup owner: 0disoft for documented defaults; local operators for private runtime config
- Escalation path: repository issues for non-sensitive config defects; SECURITY.md for config paths
  that can leak sensitive values

## Current Runtime Inputs

- `--policy`: local policy file path.
- `--profile`: named server profile inside the policy file.
- Profile `audit.destination` and `audit.path`: CLI `run` requires a file destination and uses its
  path by default.
- `--audit-log`: optional local JSONL path override for live `run`.
- `--ops-log`: optional local JSONL lifecycle metrics output path for live `run`.
- `--ops-feature-flags`: optional stable OpenFeature local-provider snapshot used only to gate
  `--ops-log` writes through `mcp.ops.metrics.enabled`.
- `--shutdown-grace-ms`: bounded upstream shutdown window.
- `--max-frame-bytes`: newline-delimited JSON-RPC frame size limit.
- `--max-json-depth`: parsed JSON depth limit.
- `--watch-policy`: opt in to atomic replacement of the active policy when the policy file changes.
- Upstream stdio server command after `--`.

## Defaults and Reload

- Default policy posture is deny-by-default.
- Live `run` reads policy at startup. With `--watch-policy`, it watches the policy file's parent
  directory so editor save-by-rename and atomic file replacement are observed, then debounces
  changes for 100 ms.
- A replacement is applied only after the complete JSON document passes policy validation and still
  contains the active profile. The session swaps one immutable snapshot, increments its policy
  revision, and clears remembered tool visibility. Calls must discover tools again under the new
  policy.
- The active profile's audit destination, path, failure action, and capture flags cannot change
  during a live run. Such a candidate is rejected because the audit writer is not part of the
  atomic policy swap. `--audit-log` remains a startup-only override.
- Read, parse, profile, audit, watcher, or runtime-validation failure leaves the previous policy
  active. Rejected policy text, parser details, and local paths are not written to stderr or ops
  events.
- Applying a replacement aborts pending approval hooks. Those calls fail closed with
  `policy.reloaded`. Calls already forwarded to the upstream server cannot be retroactively
  canceled by the protocol-boundary proxy.
- Audit output is append-oriented JSONL at the selected path.
- CLI `run` rejects stdout audit destinations before spawning upstream because stdout carries MCP.
- `includeRawArguments` and `includeFullPaths` are fixed to `false`; unsupported capture modes fail
  policy validation instead of being silently ignored.
- Ops output is append-oriented JSONL at the selected path when configured.
- Ops feature snapshots load before upstream startup and then watch atomic replacements. Valid
  configuration-change events update the cached boolean without adding file I/O to MCP evaluation.
  Invalid or unreadable replacements retain the last valid snapshot and emit a stable redacted
  stderr reason code. The provider and watcher close when the proxy run ends.
- Ops feature flags never participate in policy, discovery, call evaluation, approval, audit, frame
  limits, shutdown, or process-containment decisions.
- Live `run` does not inherit the full parent environment. It passes only `PATH` and `TMPDIR` on
  POSIX, and `PATH`, `PATHEXT`, `SystemRoot`, `WINDIR`, `ComSpec`, `TEMP`, and `TMP` on Windows.
  Arbitrary upstream environment values require a future explicit allowlist contract.
- The Windows Job Object guardian is separate from the upstream environment. It receives only the
  proxy PID plus `SystemRoot`, `WINDIR`, `TEMP`, and `TMP`, invokes the absolute system PowerShell
  executable with a fixed encoded command, and does not receive policy data, upstream argv, or the
  rest of the parent environment.
- Secret values must not be stored in policy examples, audit events, CLI JSON output, or error
  messages.
- Managed shutdown terminates POSIX process groups or Windows process trees. Windows additionally
  uses Job Object kill-on-close to reclaim descendants after abrupt proxy termination. POSIX
  operators must still use an external supervisor for equivalent parent-death cleanup.

## Drift Handling

Configuration drift is handled by failing validation or startup, or by rejecting a watched
replacement while retaining the active snapshot. Unknown policy shape, unsupported methods,
invalid frame limits, and malformed JSON-RPC messages are never silently accepted.

## Validation

- Required validation names: docs, smoke, check.
- Release blocker status: public behavior changes are blocked when config defaults, help text, CLI
  docs, and smoke behavior diverge.
- Remaining operational risk: file watching is a local best-effort notification boundary rather
  than a distributed config service. Audit sink changes, active-profile changes, upstream command
  changes, config migration, and environment-default registration still require restart or future
  contracts.
