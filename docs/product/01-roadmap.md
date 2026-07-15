# Roadmap

Status: Draft
Owner: 0disoft

## Purpose

Sequence MCP Security Proxy from a policy-first prototype into a small embeddable security boundary
for local MCP hosts.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Milestone 0: Contract Freeze

Status: mostly implemented for the current draft contract.

- Lock the policy model vocabulary.
- Lock the MVP MCP method allowlist.
- Define JSON audit event schema.
- Define denial error shape.
- Add LICENSE and SECURITY.md.
- Use the accepted TypeScript and pnpm implementation direction.
- Verify and record Node.js runtime floor and private workspace package names.
- Keep product package manifests MCP SDK-free under ADR 0008 and use pinned SDKs only as isolated
  external compatibility clients.

## Milestone 1: Local stdio Proxy MVP

Status: implemented for the current stdio-only boundary.

- Launch one MCP server behind stdio proxy.
- Filter tool list.
- Evaluate tool calls.
- Deny unsupported MCP methods by default.
- Support path, command, network, and redaction rules.
- Emit JSON Lines audit log.
- Provide deny-by-default sample policy.
- Require upstream responses to match pending client request ids.
- Redact upstream JSON-RPC error details before forwarding.
- Bound JSON-RPC frame size and parsed depth.
- Summarize upstream stderr without storing raw stderr lines.

## Milestone 2: Embeddable Library

Status: partially implemented with fixture-backed dry-run evidence for policy validation,
discovery inspection, allowed calls, denied calls, approval-required calls, path traversal
denials, shell denials, network decisions, redaction, CLI JSON output, public policy parsing,
audit JSONL formatting, tool-call normalization, approval hook behavior, and library decision
results.

- Expose policy parser.
- Expose tool classifier.
- Expose call evaluator.
- Expose redactor and audit formatter.
- Add compatibility fixtures for representative MCP clients.
- Expose required stable decision evidence codes for audit consumers.
- Expose an approval hook API for embedding hosts.
- Maintain fixture-backed compatibility evidence for discovery, allowed calls, denied calls,
  approval-required calls, matcher denials, redaction, CLI JSON output, public parser output,
  audit JSONL formatting, tool-call normalization, approval hook behavior, and library decision
  results.

## Milestone 3: Host Integration Hardening

- Add read-only host configuration generation. The host-neutral `stdio-json` descriptor is
  implemented with policy/profile validation and argv-preserving fixture evidence; host-specific
  adapters and direct host-file edits remain separate future work.
- Add policy dry-run workflows. Current local workflows cover policy validation, discovery
  inspection, allowed call evaluation, and denied call evaluation through fixture-backed CLI JSON
  evidence.
- Add host-specific approval UX integrations. Current planning records the host-owned UX boundary,
  runtime invariants, minimum user-facing context, failure modes, compatibility evidence, and
  release gates.
- Add transport compatibility plan for HTTP. Current planning records the non-implementation
  boundary, stdio invariants that HTTP must preserve, HTTP-specific risks, required ADR decisions,
  fixture evidence, and release gates.
- Add audit export guidance. Current local stdio guidance covers JSONL export shape, exported
  field allowlist, forbidden raw data, operator-owned retention, and audit-write fail-closed
  behavior.
- Add broader MCP client/server compatibility fixtures.
  Current evidence covers the local stdio MVP fixture corpus; broader real client/server fixtures
  still require selected host targets.

## Deferred

- Hosted policy management
- MCP server marketplace
- Enterprise SIEM adapters
- Full OS sandboxing
