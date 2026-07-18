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
- Package artifact and export surface: private workspace package exports and the five local
  tarball-tested npm candidates are documented in docs/library/package-surface.md; registry
  publication remains a release-readiness decision.
- Deprecation and migration policy: breaking policy schema or audit schema changes require migration
  notes.

## Provisional Modules

- `policy`: parse policy JSON text with `parsePolicyDocumentJson`, validate already-parsed
  unknown values with `validatePolicyDocument`, and normalize policy files.
- `method-policy`: classify supported, unsupported, and denied MCP methods.
- `classifier`: map MCP tool descriptors to capability labels.
- `evaluator`: evaluate tool calls against policy and return allow, deny, or approval-required.
- `tool-policy-coverage`: require non-deny discovery coverage for every classified capability.
- `redactor`: redact secret-like values before output.
- `audit`: create audit event objects with `createAuditEvent` and format one JSON Lines record
  with `formatAuditEventJsonLine`.
- `audit correlation`: use the optional `AuditCorrelation` event field and runtime
  `AuditCorrelator` to connect redacted protocol events without exposing raw JSON-RPC IDs.
- `path matching`: current matcher exports consume lexical argument facts only. No filesystem
  resolver or containment API is exported.
- `runtime lifecycle`: `UpstreamProcess.kill(force?)` accepts synchronous or asynchronous
  process-tree termination implementations.
- `ops`: structured local runtime lifecycle metrics types and the `msp.ops-event.v1` schema
  contract.
- `mcp`: protocol adapter types for MCP messages and `normalizeToolCallEnvelope` for deriving
  normalized tool-call facts without binding the package to one host.
- `proxy-runtime`: evaluate newline-delimited JSON-RPC messages at the proxy boundary and return
  forward, denial, and audit actions without owning subprocess IO. The package also exports
  `runApprovalHookConformance` for synthetic approval, rejection, error, abort, and concurrent hook
  validation.
- `approval`: host-owned approval callback types used by the runtime before forwarding
  approval-required calls. Requests carry opaque approval identity, profile identity, immutable
  normalized facts, and an abort signal. The approval hook API and conformance contract is
  docs/library/approval-hooks.md.

## Public Type Principles

- Decision results must include rule evidence when a rule wins.
- Decision evidence must include a stable machine-readable `code`. Consumers should use `code`
  for programmatic routing and treat `reason` as human-readable operator text.
- The complete draft code catalog is docs/library/decision-codes.md and must stay aligned with
  `DECISION_REASON_CODES` and `decision.v1.schema.json`.
- Policy evaluator rule decisions use `policy.rule_allow`, `policy.rule_deny`, and
  `policy.rule_approval_required`. Pre-rule fail-closed decisions use specific codes such as
  `policy.ambiguous_path`, `policy.free_form_shell`, `policy.ambiguous_network`,
  `policy.secret_capability_required`, and `policy.unknown_capability` instead of relying on
  reason text.
- Unsupported-method decisions must use the same evidence model as tool-call decisions.
- Redaction summaries must count replacements without exposing original values, and `redactText`
  must honor policy redaction detector kinds and replacement tokens when a policy redaction block
  is supplied.
- Policy errors must be value-based and testable.
- Policy JSON parse errors must not echo the original policy text because policy files can contain
  sensitive local paths, labels, or operational details.
- JSON-RPC adapter types must distinguish requests, notifications, and responses while still
  allowing the runtime to sanitize non-standard envelope fields before forwarding.
- Tool descriptors must preserve upstream identity without inventing tools.
- Secret-like descriptor names or descriptions may infer the `secret` capability, but the
  classifier must not treat `api` alone as secret-bearing material.
- Core policy exports should remain independent from filesystem, subprocess, network, and SDK IO.

## API Report Review

The five publishable packages have tracked API Extractor reports under `etc/api/`. Source files,
declaration output, package manifests, schemas, and the contracts documented in this directory
remain the source of truth. The reports are generated review baselines only; they make additions,
removals, and signature changes visible in code review and must not be used to invent behavior.

`pnpm run api-report` builds declarations and fails when the current public surface differs from
the tracked reports. After deciding the semver and migration impact, a maintainer may regenerate
the baselines with `pnpm build` followed by
`node scripts/check-api-reports.mjs --update`. The changed reports must be reviewed and committed
with the implementation and its version or migration notes. Forgotten exports fail extraction so
public signatures cannot refer to unnamed package-private types. Release-tag enforcement remains a
separate future documentation task and is intentionally not represented as report noise during the
alpha API inventory.

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
- API report changes lack an explicit semver and migration review.
