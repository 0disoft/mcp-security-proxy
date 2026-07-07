# Config and Environment

Status: Draft

## Operational Contract

Configuration is a runtime contract. The current implementation uses explicit CLI flags, local
policy files, and safe defaults. Environment variables may be added later only for documented,
non-secret convenience defaults.

## Owners

- Primary owner: 0disoft
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive config defects; SECURITY.md for config paths
  that can leak sensitive values

## Current Runtime Inputs

- `--policy`: local policy file path.
- `--profile`: named server profile inside the policy file.
- `--audit-log`: local JSONL audit output path for live `run`.
- `--shutdown-grace-ms`: bounded upstream shutdown window.
- `--max-frame-bytes`: newline-delimited JSON-RPC frame size limit.
- `--max-json-depth`: parsed JSON depth limit.
- Upstream stdio server command after `--`.

## Defaults and Reload

- Default policy posture is deny-by-default.
- Live `run` reads policy at startup; hot reload is not implemented.
- Audit output is append-oriented JSONL at the selected path.
- Upstream environment passthrough must stay allowlist-based if environment support is added.
- Secret values must not be stored in policy examples, audit events, CLI JSON output, or error
  messages.

## Drift Handling

Configuration drift is handled by failing validation or startup rather than silently accepting
unknown policy shape, unsupported methods, invalid frame limits, or malformed JSON-RPC messages.

## Validation

- Required validation names: docs, smoke, check.
- Release blocker status: public behavior changes are blocked when config defaults, help text, CLI
  docs, and smoke behavior diverge.
- Remaining operational risk: no config reload, config migration command, or environment-default
  registry exists yet.
