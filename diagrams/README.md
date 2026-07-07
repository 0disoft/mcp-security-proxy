# Diagrams

Status: Draft
Owner: 0disoft

## Purpose

Diagrams provide reviewable views of the MCP Security Proxy boundary, runtime flow, and operational
release paths. They are explanatory source material for humans, not generated architecture truth.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Diagram Inventory

- `system-context.mmd`: local user, AI host, MCP proxy, and MCP server boundary.
- `container-view.mmd`: CLI, runtime, policy engine, contract package, fixtures, and audit output.
- `core-runtime-flow.mmd`: discovery filtering, call evaluation, method policy, approval hooks, and
  audit events.
- `release-flow.mmd`: validation and release-record evidence path.
- `rollback-flow.mmd`: recovery path when release evidence or runtime behavior regresses.

## Required Evidence

- Boundary: diagrams must show MCP protocol-boundary control, not OS sandboxing.
- Data ownership: diagrams must keep policy and audit data local to the user or embedding host.
- Failure and recovery behavior: diagrams must preserve deny-by-default and fail-closed paths where
  they appear.
- Validation needed before merge: docs validation and repository hygiene checks.

## Review Blockers

- The change shows the proxy as a complete OS sandbox, malware scanner, hosted control plane, or
  secret manager.
- The change implies raw prompts, tool arguments, secrets, or environment values are stored in audit
  output.
- The change contradicts documented CLI, runtime, release, or rollback contracts.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
