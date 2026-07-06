# Testing Standard

Status: Draft

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related checklist: .agents/checklists/security.md

## Required Test Families

- Unit tests for policy parsing, rule precedence, classifier evidence, evaluator decisions,
  redaction, and audit event formatting.
- Golden fixture tests for policy input to decision output.
- Property tests for path normalization, URL/domain parsing, command argv matching, and redaction
  detectors.
- Integration tests with a fake stdio MCP server.
- Contract tests for CLI JSON output, exit codes, policy schema, audit schema, and migration notes.
- Regression tests for every confirmed bypass.
- Cross-platform tests for Windows, macOS, and Linux path behavior before claiming support.
- Docs tests for user-facing command examples after commands exist.

## Required Fixtures

- `tools/list` with safe, risky, ambiguous, and unknown tools.
- allowed and denied file-read calls.
- denied shell command calls.
- network argument examples that show intent-policy limits.
- unsupported method requests.
- invalid JSON, stderr spam, partial lines, server crash, and slow upstream responses.
- redaction fixtures where secret-like strings never appear in audit snapshots.

Fixtures must be synthetic and safe for the public repository.

## Review Blockers

- A matcher changes without unit and fixture coverage.
- A public schema changes without contract tests and migration notes.
- A compatibility claim lacks integration evidence.
- An audit fixture contains raw secret-like values after redaction.
- A change weakens validation or hides skipped checks.
