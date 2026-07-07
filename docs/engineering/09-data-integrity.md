# Data Integrity

Status: Draft

## Contract

Data integrity covers policy normalization, decision evidence, audit event structure, schema
versioning, and contract drift.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Integrity Rules

- Policy schema, decision schema, and audit schema must be versioned before public release.
- Schema constants and JSON Schema assets must stay synchronized through `pnpm run
  schema-contract`.
- Evaluator decisions must include rule evidence.
- Discovery filtering must preserve upstream tool identity for visible tools and must not invent
  tools.
- Audit events must be written from redacted summaries.
- Migration notes are required when schema fields, defaults, matcher semantics, exit codes, or
  public types change.
- Generated schemas must be reproducible from source once generation exists.

## Review Blockers

- A decision lacks rule evidence.
- A schema changes without migration notes.
- `pnpm run schema-contract` fails.
- A redacted audit event cannot be traced to a policy decision.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
