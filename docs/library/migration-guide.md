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

The first public prerelease is `0.2.0-alpha.1`. Changes after that immutable publication are
unreleased until a later prerelease record approves and publishes them.

- Unreleased CLI addition: `config-snippet --target stdio-json` adds a read-only command and extends
  the public `CommandName` union. Existing commands and exit codes are unchanged. Users previously
  hand-authored a host command and argv array; they may now generate the same descriptor after the
  CLI validates the policy and profile. No existing configuration edit is required. The output may
  contain supplied local paths but never policy contents or environment values. Rollback is to
  ignore the additive command and continue invoking `run` directly. This is minor/additive API and
  CLI surface for the next prerelease.
- Unreleased Codex adapter addition: `config-snippet --target codex-cli-json` requires a safe
  `--name` and emits `codex mcp add` command/argv without executing it. Existing `stdio-json` output
  is unchanged. No user Codex configuration is migrated automatically; rollback is to ignore the
  new target or remove a registration separately through Codex if the generated command was run.
- Unreleased Gemini adapter addition: `config-snippet --target gemini-cli-json` requires an
  underscore-free `--name` and emits project-scoped `gemini mcp add` argv without executing it.
  Existing targets are unchanged. Rollback is to ignore the target or remove the project-scoped
  registration through Gemini if the descriptor was run.

- Current draft schema versions: `msp.policy.v1`, `msp.decision.v1`, and `msp.audit-event.v1`.
- Current draft decision note: decision evidence requires a stable `code` field. The
  `decision.v1.schema.json` asset requires the same code values exported by the contracts package.
  Rule decisions, method decisions, protocol-boundary decisions, runtime failures, and pre-rule
  fail-closed decisions now emit stable codes so consumers do not parse human-readable reason text.
- Current draft runtime API note: proxy session and stdio bridge options may include an optional
  approval timeout. Existing embedders that omit it keep the previous no-runtime-timeout behavior.
- Current draft audit policy note: `includeFullPaths` is fixed to `false` because full-path capture
  is not implemented. CLI `run` requires `audit.destination: file`, uses the profile `audit.path`
  by default, and treats `--audit-log` as an explicit path override. Embedding hosts may still own
  a stdout sink when they can keep it separate from MCP protocol output.
- Current draft audit correlation note: audit events may now include an optional `correlation`
  object with `correlationVersion: msp.audit-correlation.v2`. Existing v1 consumers must ignore
  unknown optional fields. Opt-in consumers may route by session ID, transport event ID, sequence,
  and HMAC-hashed JSON-RPC ID; they must not expect hashes to remain stable across sessions.
- Current draft runtime lifecycle note: `UpstreamProcess.kill` may now return a promise so hosts can
  complete process-tree termination. Existing synchronous implementations remain valid. The stdio
  bridge bounds a hanging or rejected termination callback and continues shutdown escalation.
- Current draft path-policy clarification: existing `msp.policy.v1` path rules retain lexical
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
