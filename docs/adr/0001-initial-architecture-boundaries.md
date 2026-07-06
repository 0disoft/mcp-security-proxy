# Initial Architecture Boundaries

Status: Draft
Owner: 0disoft

## Purpose

Record the first architecture boundary for MCP Security Proxy.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/architecture/00-system-boundary.md

## Required Decisions

- Boundary: MCP protocol-boundary proxy, not OS sandbox.
- Data ownership: policy files and audit outputs are local to the user or embedding host.
- Failure and recovery behavior: deny unsupported methods, unknown capabilities, ambiguous
  matcher inputs, and missing approval hooks by default.
- Validation needed before merge: VALIDATION.md

## Decision

The proxy mediates MCP messages between a host and an upstream server. It owns policy evaluation,
tool discovery filtering, tool-call decisions, method support, redaction, audit event formatting,
CLI behavior, and library contracts.

It does not own process isolation, kernel enforcement, malware scanning, secret storage, hosted
policy management, MCP marketplace behavior, or side effects performed directly by the upstream
server outside MCP messages.

## Review Blockers

- The change claims protection outside the MCP protocol boundary.
- The change passes unsupported MCP methods through without a documented policy.
- The change stores raw secrets or raw sensitive tool arguments in audit events.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
