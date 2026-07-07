# Public API

Status: Draft
Repository Type: library

## Repository Type Contract

This repository type owns public API surface, package compatibility, semantic versioning, migration guidance, distribution artifacts, and consumer-facing deprecation policy.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Public API ownership: policy parsing, MCP method policy, tool classification, normalized call
  evaluation, redaction, and audit event formatting.
- Semantic versioning policy: public types and decision semantics are semver-covered once the first
  package release is cut.
- Runtime and platform compatibility: UNDECIDED.
- Package artifact and export surface: must be documented before implementation release.
- Deprecation and migration policy: breaking policy schema or audit schema changes require migration
  notes.

## Provisional Modules

- `policy`: parse, validate, and normalize policy files.
- `method-policy`: classify supported, unsupported, and denied MCP methods.
- `classifier`: map MCP tool descriptors to capability labels.
- `evaluator`: evaluate tool calls against policy and return allow, deny, or approval-required.
- `redactor`: redact secret-like values before output.
- `audit`: format JSON Lines audit events.
- `mcp`: protocol adapter types for MCP messages without binding the whole package to one host.
- `proxy-runtime`: evaluate newline-delimited JSON-RPC messages at the proxy boundary and return
  forward, denial, and audit actions without owning subprocess IO.

## Public Type Principles

- Decision results must include rule evidence when a rule wins.
- Decision evidence may include an optional stable machine-readable code. Consumers should prefer
  `code` for programmatic routing and treat `reason` as human-readable operator text.
- Unsupported-method decisions must use the same evidence model as tool-call decisions.
- Redaction summaries must count replacements without exposing original values.
- Policy errors must be value-based and testable.
- Tool descriptors must preserve upstream identity without inventing tools.
- Core policy exports should remain independent from filesystem, subprocess, network, and SDK IO.

The current runtime-facing library surface includes a newline-delimited JSON-RPC session gate that
returns forward lines, denial response lines, and redacted audit events. Subprocess lifecycle,
stdio wiring, and CLI output routing belong to the CLI/runtime bridge, not the core evaluator.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
