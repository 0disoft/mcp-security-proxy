# Host Approval UX Integration Plan

Status: Draft

## Purpose

Approval UX is host-owned. MCP Security Proxy exposes approval decisions and runtime hooks, but it
does not bundle an approval dialog, notification system, browser UI, editor extension, or agent
runtime. This plan defines the minimum safety contract a host-specific approval UX must satisfy
before it can be documented as supported.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Runtime flow: docs/architecture/02-runtime-flow.md
- Method policy: docs/architecture/05-mcp-method-policy.md
- Library API: docs/library/public-api.md

## Non-Implementation Boundary

This document does not select a host, UI framework, extension API, browser surface, or approval
storage backend. It does not approve any bundled approval UI. Host-specific integrations require a
later ADR or release record that names the host, user interaction model, persistence behavior,
accessibility expectations, and validation evidence.

## Approval UX Invariants

A host approval UX must preserve these runtime invariants:

- approval-required calls are not forwarded until the host hook returns an explicit approval;
- missing approval hooks resolve to deny;
- approval hook rejection resolves to deny and does not forward the call;
- approval hook errors fail closed;
- raw hook rejection reasons are not forwarded or stored verbatim;
- the prompt shown to a user is derived from normalized call facts and decision evidence, not raw
  MCP payloads;
- optional runtime approval timeouts fail closed without forwarding the call;
- host work observes `ApprovalRequest.signal` and closes pending UI or background work after abort;
- concurrent prompts are keyed by opaque `ApprovalRequest.approvalId`, never raw JSON-RPC ids;
- a stale approval must not approve a different JSON-RPC request id, tool name, capability, or
  argument-fact summary;
- deny, timeout, close, dismiss, and navigation-away states must all resolve to deny.

## User-Facing Minimum Context

The host UX must show enough context for a real decision without exposing raw sensitive payloads:

- tool name;
- capability labels;
- matched rule id when available;
- decision evidence code;
- redacted path, command, or network summaries when available;
- policy profile id;
- whether the action is one-time, session-scoped, or persistent.

Persistent or remembered approvals are not part of the current runtime contract. If a future host
adds them, the ADR must define scope, expiry, revocation, storage location, audit evidence, and
how policy changes invalidate prior approvals.

## Host Integration Failure Modes

Host-specific approval UX must explicitly handle:

- multiple concurrent approval prompts;
- duplicated or replayed requests;
- tool discovery changing between prompt display and approval;
- policy reload or profile change while a prompt is open;
- host window close, process shutdown, or extension reload;
- localization or truncation hiding the risky part of a decision;
- screen reader and keyboard-only approval flows;
- accidental default approval through focused buttons or keyboard shortcuts;
- audit write failure after approval.

## Compatibility Evidence Required

A host-specific approval integration must add fixture-backed evidence before release claims:

- missing hook denial;
- hook approval forwarding;
- hook rejection denial;
- hook error fail-closed behavior;
- raw rejection reason redaction;
- stale request or mismatched decision denial;
- audit event output for approved, denied, rejected, and failed approval paths;
- CLI or library dry-run evidence that documents the same approval-required decision shape.

## Release Gate

Approval UX support remains blocked until:

- a host target is selected;
- the host-specific ADR is approved;
- docs name the exact user interaction and persistence semantics;
- accessibility and keyboard behavior are documented for that host;
- compatibility fixtures are registered in `fixtures/compatibility/manifest.json`;
- `docs`, `schema-contract`, `migration-check`, `package-surface`, `secret-scan`,
  `artifact-safety`, `repository-hygiene`, `validation-registry`, `ci-contract`, `compatibility`,
  `performance-smoke`, `smoke`, and `check` pass;
- the release record names approval UX support as included or explicitly excluded.

## Current Status

The runtime approval hook is implemented for embedding hosts. Host-specific approval UX is not
implemented. The public runtime conformance kit covers hook mechanics but does not approve any host
UX. The CLI `run` command intentionally does not bundle approval UX and rejects `--approval-hook`
for live runs.
