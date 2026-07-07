# Development

Status: Draft
Owner: 0disoft

## Purpose

Development work should keep the CLI, runtime, contracts, fixtures, and documentation aligned around
a local MCP protocol-boundary proxy. The implementation must remain boring: explicit policy,
deterministic denial, bounded parsing, redacted audit events, and validation that catches drift
before release.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Local Development Contract

- Runtime boundary: stdio MCP proxy first; HTTP transport remains deferred.
- Data ownership: policy files, captured fixtures, and audit files are local to the user or
  embedding host.
- Failure and recovery behavior: fail closed for policy parse errors, unsupported methods, audit
  write failures under `fail_closed`, missing approval hooks, malformed JSON-RPC frames, oversized
  frames, and excessive JSON depth.
- Validation needed before merge: use VALIDATION.md names. Prefer focused scripts for the changed
  surface, then `pnpm check` before merging broad or release-adjacent changes.

## Working Notes

- Use source files, schemas, fixtures, and docs as source truth; do not rely on `dist/`,
  `node_modules/`, cache output, or generated test results.
- Keep dry-run commands safe for JSON piping and keep live `run` stdout reserved for protocol
  messages.
- Add or update fixtures when behavior changes at an MCP trust boundary.
- Keep public release decisions in release records instead of hard-coding guesses into code or docs.

## Review Blockers

- The change adds policy, CLI, or runtime behavior without matching contract tests or validation.
- The change weakens method allowlisting, response correlation, redaction, audit behavior, or frame
  limits.
- The change makes release or package decisions without an ADR or release record.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
