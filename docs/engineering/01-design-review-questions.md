# Design Review Questions

Status: Draft

## Contract

Design review questions must cover problem boundary, ownership, data/state, failure and recovery, future cost, and source-of-truth drift.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Questions

- Does this stay inside the MCP protocol boundary?
- Does it accidentally claim OS sandbox, socket enforcement, malware scanning, or secret-vault
  behavior?
- Which MCP methods does it allow, deny, or defer?
- Which policy facts are normalized before the evaluator sees them?
- Could the upstream server do the same side effect outside MCP messages?
- What raw data is inspected, and what redacted summary is retained?
- What happens when audit write, approval hook, upstream startup, or protocol parsing fails?
- Which contract document, fixture, or migration note changes with this design?

## Review Blockers

- A design cannot answer its boundary, data, and failure questions.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
