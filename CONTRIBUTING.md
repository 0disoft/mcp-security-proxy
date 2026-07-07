# Contributing

Status: Draft
Owner: 0disoft

## Purpose

This project accepts changes that strengthen MCP protocol-boundary policy enforcement, redacted
audit evidence, CLI behavior, and library contracts without expanding the project into an OS
sandbox, malware scanner, or hosted control plane.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Contribution Rules

- Keep examples deny-by-default and require explicit allow rules for file, shell, network, and
  secret-sensitive capabilities.
- Do not claim tool schemas prove safety; classification evidence is heuristic unless policy makes
  an explicit decision.
- Do not store or log raw secrets, environment values, prompts, or tool arguments.
- Keep stdout reserved for MCP protocol frames in live `run` mode.
- Leave public package names, registry targets, and release artifact names as `UNDECIDED` until an
  ADR or release record decides them.

## Required Evidence

- Boundary: local stdio MCP proxy first.
- Data ownership: policy and audit files remain local to the user or embedding host.
- Failure and recovery behavior: deny-by-default for unsupported methods, unknown high-risk
  capability, ambiguous matcher input, and missing approval hooks.
- Validation needed before merge: use the stable validation names in VALIDATION.md and run the
  narrowest configured checks that cover the changed behavior.

## Review Blockers

- The change expands scope into OS sandboxing, malware scanning, secret management, or hosted policy
  control without a new ADR.
- The change passes unsupported MCP methods through without policy.
- The change weakens redaction, audit safety, approval-hook fail-closed behavior, or
  deny-by-default handling.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
