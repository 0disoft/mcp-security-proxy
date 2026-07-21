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

Status: implemented for the current alpha library boundary with fixture-backed evidence for policy validation,
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

Status: partially implemented. Configuration generation, isolated Codex and Gemini CLI acceptance,
Gemini host-policy evaluation, approval-hook conformance, atomic policy reload, registry onboarding,
and independently packaged filesystem and fetch server rows exist. In-band host approval UI and HTTP
transport remain outside the implemented boundary.

- Add read-only host configuration generation. The host-neutral `stdio-json`, Codex CLI, and Gemini
  CLI registration descriptors are implemented with policy/profile validation, argv-preserving
  fixture evidence, and isolated host CLI acceptance checks. Direct host-file edits and other host
  adapters remain separate future work.
- Add policy dry-run workflows. Current local workflows cover policy validation, discovery
  inspection, allowed call evaluation, and denied call evaluation through fixture-backed CLI JSON
  evidence.
- Add host-specific approval UX integrations. The runtime conformance kit and Gemini host-policy
  fixture prove fail-closed approval behavior, but no host-specific in-band approval UI bridge is
  claimed. That bridge still requires its own protocol and accessibility evidence.
- Add transport compatibility plan for HTTP. Current planning records the non-implementation
  boundary, stdio invariants that HTTP must preserve, HTTP-specific risks, required ADR decisions,
  fixture evidence, release gates, and the real-demand gate that must be met before implementation.
- Add audit export guidance. Current local stdio guidance covers JSONL export shape, exported
  field allowlist, forbidden raw data, operator-owned retention, and audit-write fail-closed
  behavior.
- Add broader MCP client/server compatibility fixtures. Current evidence covers JavaScript and
  Python clients against the pinned filesystem server plus an independently packaged Python fetch
  server. These exact rows are evidence only for their recorded scenarios, not arbitrary MCP
  compatibility.

## Alpha Exit Criteria

Moving from `0.2.x-alpha` to `0.3.0-beta` requires all of the following on the exact candidate commit:

- the public API inventory and migration guide cover every exported package surface and additive or
  breaking change;
- exact-version registry onboarding installs the five public packages in a clean consumer and
  completes a real stdio session without checkout build output;
- approval-hook conformance covers approve, reject, error, abort cleanup, and concurrent identity,
  with at least one independently evaluated host policy fixture;
- the compatibility registry contains at least two independently packaged MCP server
  implementations and both JavaScript and Python client evidence without adding their SDKs to
  product dependencies;
- atomic policy replacement retains the last valid policy on rejection, invalidates discovery,
  aborts stale approvals, and does not change the live audit sink;
- managed shutdown and abrupt proxy termination reclaim inherited process trees on the supported
  Ubuntu and Windows runners, with deliberate new-session escape documented as an external
  supervisor boundary;
- no unresolved critical or high-severity defect remains in protocol validation, policy evaluation,
  audit redaction, approval, or subprocess lifecycle behavior;
- the complete configured validation chain passes and an approved release record pins that exact
  commit, package set, rollback version, and included or excluded compatibility scope.

Meeting these criteria permits beta review; it does not authorize publication, HTTP transport, or a
stable `1.0.0` compatibility claim by itself.

## Deferred

- Hosted policy management
- MCP server marketplace
- Enterprise SIEM adapters
- Full OS sandboxing
