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

- Lock the policy model vocabulary.
- Lock the MVP MCP method allowlist.
- Define JSON audit event schema.
- Define denial error shape.
- Add LICENSE and SECURITY.md.
- Use the accepted TypeScript and pnpm implementation direction.
- Verify and record Node.js runtime floor and private workspace package names.
- Leave MCP SDK dependency choice and public release artifact names for later ADRs.

## Milestone 1: Local stdio Proxy MVP

- Launch one MCP server behind stdio proxy.
- Filter tool list.
- Evaluate tool calls.
- Deny unsupported MCP methods by default.
- Support path, command, network, and redaction rules.
- Emit JSON Lines audit log.
- Provide deny-by-default sample policy.

## Milestone 2: Embeddable Library

- Expose policy parser.
- Expose tool classifier.
- Expose call evaluator.
- Expose redactor and audit formatter.
- Add compatibility fixtures for representative MCP clients.

## Milestone 3: Host Integration Hardening

- Add policy dry-run workflows.
- Add approval hook interface.
- Add transport compatibility plan for HTTP.
- Add audit export guidance.

## Deferred

- Hosted policy management
- MCP server marketplace
- Enterprise SIEM adapters
- Full OS sandboxing
