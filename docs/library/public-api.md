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
- Runtime and platform compatibility: TypeScript, pnpm, and Node.js `>=24.0.0` for the current
  private workspace packages.
- Package artifact and export surface: private workspace package exports are documented in
  docs/library/package-surface.md; public registry artifacts remain a release-readiness decision.
- Deprecation and migration policy: breaking policy schema or audit schema changes require migration
  notes.

## Provisional Modules

- `policy`: parse policy JSON text with `parsePolicyDocumentJson`, validate already-parsed
  unknown values with `validatePolicyDocument`, and normalize policy files.
- `method-policy`: classify supported, unsupported, and denied MCP methods.
- `classifier`: map MCP tool descriptors to capability labels.
- `evaluator`: evaluate tool calls against policy and return allow, deny, or approval-required.
- `redactor`: redact secret-like values before output.
- `audit`: create audit event objects with `createAuditEvent` and format one JSON Lines record
  with `formatAuditEventJsonLine`.
- `mcp`: protocol adapter types for MCP messages without binding the whole package to one host.
- `proxy-runtime`: evaluate newline-delimited JSON-RPC messages at the proxy boundary and return
  forward, denial, and audit actions without owning subprocess IO.
- `approval`: host-owned approval callback types used by the runtime before forwarding
  approval-required calls.

## Public Type Principles

- Decision results must include rule evidence when a rule wins.
- Decision evidence must include a stable machine-readable `code`. Consumers should use `code`
  for programmatic routing and treat `reason` as human-readable operator text.
- Policy evaluator rule decisions use `policy.rule_allow`, `policy.rule_deny`, and
  `policy.rule_approval_required`. Pre-rule fail-closed decisions use specific codes such as
  `policy.ambiguous_path`, `policy.free_form_shell`, `policy.ambiguous_network`,
  `policy.secret_capability_required`, and `policy.unknown_capability` instead of relying on
  reason text.
- Unsupported-method decisions must use the same evidence model as tool-call decisions.
- Redaction summaries must count replacements without exposing original values.
- Policy errors must be value-based and testable.
- Policy JSON parse errors must not echo the original policy text because policy files can contain
  sensitive local paths, labels, or operational details.
- Tool descriptors must preserve upstream identity without inventing tools.
- Secret-like descriptor names or descriptions may infer the `secret` capability, but the
  classifier must not treat `api` alone as secret-bearing material.
- Core policy exports should remain independent from filesystem, subprocess, network, and SDK IO.

The current runtime-facing library surface includes a newline-delimited JSON-RPC session gate that
returns forward lines, denial response lines, and redacted audit events. Subprocess lifecycle,
stdio wiring, and CLI output routing belong to the CLI/runtime bridge, not the core evaluator.
Approval hooks receive normalized call facts and policy decision evidence, not raw MCP payloads.
Hosts own the user experience and final approval source. Hook rejection reasons are treated as
host-owned input and are not forwarded or stored verbatim by the proxy runtime. Embedders may set
an optional approval timeout on the runtime session or stdio bridge; timed-out hooks fail closed
without forwarding the call. Host-specific approval UX acceptance criteria are documented in
docs/architecture/08-host-approval-ux-plan.md.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
