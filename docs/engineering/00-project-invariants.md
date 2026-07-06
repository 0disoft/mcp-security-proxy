# Project Invariants

Status: Draft

## Contract

Project invariants define what must remain true across implementation, tests, docs, configuration, and release behavior.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Invariants

- The proxy is an MCP protocol-boundary policy gate, not an OS sandbox.
- Unsupported MCP methods are denied by default until explicitly supported.
- Unknown or ambiguous capability is denied by default.
- Policy decisions are deterministic for the same policy and normalized facts.
- Raw secrets, environment values, prompts, and full sensitive tool arguments are not written to
  audit output.
- Public fixtures are synthetic.
- Generated, cache, build, and local run output are not source truth.

## Review Blockers

- A change bypasses or weakens an invariant without an ADR.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
