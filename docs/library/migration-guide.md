# Migration Guide

Status: Draft
Repository Type: library

## Repository Type Contract

This repository type owns public API surface, package compatibility, semantic versioning, migration guidance, distribution artifacts, and consumer-facing deprecation policy.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Public API ownership: docs/library/public-api.md
- Semantic versioning policy: docs/library/semver.md
- Runtime and platform compatibility: docs/library/compatibility.md
- Package artifact and export surface: docs/library/package-surface.md
- Deprecation and migration policy: documented here.

## Migration Note Requirements

Migration notes are required when a change affects:

- policy schema fields, defaults, rule ordering, or matcher semantics
- audit event schema fields, redaction behavior, or event classification
- public library exports, public type names, or package entrypoints
- CLI output, JSON output, exit codes, config precedence, or shell completion behavior
- runtime compatibility floors
- deny-by-default sample policies or security examples

Migration notes must include:

- affected versions
- affected users or consumers
- before and after behavior
- exact policy, API, or CLI changes required
- security impact, especially when behavior can allow or deny different MCP tool calls
- rollback or downgrade notes when possible

## Current Migration Notes

The latest published prerelease is `0.2.0-alpha.4`. It contains the additive and
security-hardening changes below.

The approved `0.2.0-alpha.5` candidate contains these changes after `0.2.0-alpha.4`:

- Forced-shutdown stream handling: when the runtime exhausts its bounded upstream termination
  window and deliberately destroys still-open stdout or stderr pipes, Node may report
  `ERR_STREAM_PREMATURE_CLOSE`. The bridge now treats that error as expected only for pipes it
  destroyed during its own forced-shutdown path and preserves the upstream failure exit code 4.
  Other stream failures remain fatal. No public option, policy, schema, or host configuration
  changes are required. Rollback to `0.2.0-alpha.4` restores the risk that a forced shutdown is
  misclassified as a generic runtime failure and may surface an unhandled stream rejection.
- Publication evidence hardening: tracked publication receipts now have closed Draft 2020-12 JSON
  Schemas for v1 and v2 plus fixed positive and negative fixtures. This is an operations-only
  validation contract and does not add a runtime package export or require a consumer migration.
- Registry onboarding validation now exercises installed CLI ops feature-flag reload, valid
  configuration-change events, invalid replacement retention, and redacted audit output. This
  strengthens post-publication evidence only; the public CLI behavior was already shipped in
  `0.2.0-alpha.4`.

`0.2.0-alpha.4` adds these fixes and clarifications after `0.2.0-alpha.3`:

- Ops-only feature reload: CLI `run` adds optional `--ops-feature-flags <path>`, which requires
  `--ops-log` and evaluates only `mcp.ops.metrics.enabled`. Existing invocations are unchanged.
  Valid provider configuration-change events update future ops writes; invalid replacements retain
  the last valid snapshot. Policy, discovery, calls, approvals, audit, and containment are
  unaffected. Rollback is to omit `--ops-feature-flags` and keep the existing always-on
  `--ops-log` behavior.
- Runtime correlation fix: pending client requests now expire at `pendingRequestTtlMs`, matching the
  documented server-origin behavior. Before this fix, client requests remained correlated without
  a TTL; after it, late upstream responses are dropped as `jsonrpc.unmatched_response`, and the
  expired ID may be reused. Embedders that need a longer response window should increase
  `pendingRequestTtlMs`. Rollback restores stale correlation and its memory and response-confusion
  risk; no policy schema edit is required.
- Command matcher clarification: a command rule `argv` array must have the same length as the
  observed argv, and each `*` entry matches exactly one argument at that position. It never matches
  zero or multiple arguments. This documents existing behavior; no policy edit or rollback is
  required.
- Windows startup hardening: the fail-closed system PowerShell guardian now allows a longer bounded
  cold-start window before returning exit code 4. The Job Object containment model and policy
  configuration are unchanged. Rollback restores the shorter window and its hosted-runner flake
  risk.

- `0.2.0-alpha.2` CLI addition: `config-snippet --target stdio-json` adds a read-only command and
  extends the public `CommandName` union. Existing commands and exit codes are unchanged. Users
  previously hand-authored a host command and argv array; they may now generate the same descriptor
  after the CLI validates the policy and profile. No existing configuration edit is required. The
  output may contain supplied local paths but never policy contents or environment values. Rollback
  is to ignore the additive command and continue invoking `run` directly. This is minor/additive API and
  CLI surface.
- `0.2.0-alpha.2` Codex adapter addition: `config-snippet --target codex-cli-json` requires a safe
  `--name` and emits `codex mcp add` command/argv without executing it. Existing `stdio-json` output
  is unchanged. No user Codex configuration is migrated automatically; rollback is to ignore the
  new target or remove a registration separately through Codex if the generated command was run.
- `0.2.0-alpha.2` Gemini adapter addition: `config-snippet --target gemini-cli-json` requires an
  underscore-free `--name` and emits project-scoped `gemini mcp add` argv without executing it.
  Existing targets are unchanged. Rollback is to ignore the target or remove the project-scoped
  registration through Gemini if the descriptor was run.

- `0.2.0-alpha.3` schema versions remain `msp.policy.v1`, `msp.decision.v1`, and
  `msp.audit-event.v1`.
- `0.2.0-alpha.3` decision note: decision evidence requires a stable `code` field. The
  `decision.v1.schema.json` asset requires the same code values exported by the contracts package.
  Rule decisions, method decisions, protocol-boundary decisions, runtime failures, and pre-rule
  fail-closed decisions now emit stable codes so consumers do not parse human-readable reason text.
- `0.2.0-alpha.3` runtime API note: proxy session and stdio bridge options may include an optional
  approval timeout. Existing embedders that omit it keep the previous no-runtime-timeout behavior.
- `0.2.0-alpha.3` policy reload note: CLI `run --watch-policy` is additive and opt-in. Existing runs
  remain startup-only. Valid replacements must preserve the active profile and its audit settings;
  accepted replacements clear discovery state and abort pending approvals with `policy.reloaded`.
  Embedders may use additive `ProxySession.replacePolicy`, the one-shot
  `preparePolicyReplacement` commit API, `PolicyReloadSource`, and `PolicyReloadUpdate`. Rollback is
  to omit `--watch-policy` or restart with the last known-good policy. No `msp.policy.v1` file edit
  is required.
- `0.2.0-alpha.3` approval hook note: `ApprovalRequest` now adds opaque `approvalId`, `profileId`, and
  `signal` fields. Existing hooks may ignore the additive fields, but hosts with pending UI or
  background work should stop it when `signal` aborts and key concurrent prompts by `approvalId`.
  Hook results now require an exact boolean `approved` field; malformed JavaScript results fail
  closed. `runApprovalHookConformance` is an additive runtime export for synthetic host validation.
  Rollback removes cancellation and conformance support and restores the older timeout leak risk.
- `0.2.0-alpha.3` audit policy note: `includeFullPaths` is fixed to `false` because full-path capture
  is not implemented. CLI `run` requires `audit.destination: file`, uses the profile `audit.path`
  by default, and treats `--audit-log` as an explicit path override. Embedding hosts may still own
  a stdout sink when they can keep it separate from MCP protocol output.
- `0.2.0-alpha.3` audit correlation note: audit events may now include an optional `correlation`
  object with `correlationVersion: msp.audit-correlation.v2`. Existing v1 consumers must ignore
  unknown optional fields. Opt-in consumers may route by session ID, transport event ID, sequence,
  and HMAC-hashed JSON-RPC ID; they must not expect hashes to remain stable across sessions.
- `0.2.0-alpha.3` runtime lifecycle note: `UpstreamProcess.kill` may now return a promise so hosts can
  complete process-tree termination. Existing synchronous implementations remain valid. The stdio
  bridge bounds a hanging or rejected termination callback and continues shutdown escalation.
- `0.2.0-alpha.3` Windows containment note: installed CLI `run` now starts a fixed, non-interactive
  system PowerShell guardian before the upstream server, assigns the proxy to a nested Job Object,
  and reclaims descendants after abrupt proxy termination. No policy or host configuration edit is
  required. A Windows host without system PowerShell or usable nested Job support now fails closed
  with exit code 4 before upstream startup instead of running without crash containment. Rollback is
  to use the previous CLI with an external process supervisor, accepting the older orphan risk.
- `0.2.0-alpha.3` path-policy clarification: existing `msp.policy.v1` path rules retain lexical
  behavior. They do not resolve symlinks or prove the target opened by an upstream server. No policy
  edit is required; integrations making stronger claims must narrow those claims or add a separate
  host/OS enforcement boundary.
- `pnpm run migration-check` verifies that current schema versions and migration-note blockers stay
  represented here before release validation passes.

## Migration Principles

- Do not make a previously denied tool call become allowed without an explicit migration note.
- Do not weaken redaction defaults silently.
- Do not rename policy fields without either compatibility handling or a documented manual edit.
- Do not change audit event meaning without telling log consumers how to update parsers.
- Prefer deny-by-default examples during migration, even when documenting compatibility shims.
- Keep migration examples free of real secrets, raw prompts, and raw MCP tool arguments.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
- Policy, audit, output, or exit-code compatibility changes lack migration notes.
- Migration examples include secret-like values or captured sensitive payloads.
