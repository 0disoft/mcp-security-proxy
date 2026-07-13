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

No released implementation exists yet. Until the first public release, breaking documentation
changes must still update the source-of-truth docs so early adopters do not build against stale
policy, audit, CLI, or API contracts.

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
