# Compatibility

Status: Draft
Repository Type: library

## Repository Type Contract

This repository type owns public API surface, package compatibility, semantic versioning, migration guidance, distribution artifacts, and consumer-facing deprecation policy.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Public API ownership: docs/library/public-api.md
- Semantic versioning policy: docs/library/semver.md
- Runtime and platform compatibility: TypeScript, pnpm, and Node.js `>=24.0.0` for the current
  scaffold.
- Package artifact and export surface: five public npm packages are recorded, local-tarball tested,
  and exact-version registry tested for `0.2.0-alpha.1`.
- Deprecation and migration policy: docs/library/migration-guide.md

## Compatibility Targets

- MCP stdio transport first.
- HTTP transport planning is documented in docs/architecture/07-http-transport-plan.md, but HTTP is
  not implemented.
- TypeScript project references and pnpm workspace checks are the current local compatibility
  baseline.
- Node.js `>=24.0.0` is the current package manifest floor and must stay consistent across the
  workspace until a release readiness record changes it.
- HTTP transport support is deferred until stdio behavior is proven and HTTP-specific compatibility
  fixtures exist.
- Client compatibility must be fixture-backed, not claimed from schema reading alone.
- Policy and audit schemas must remain deterministic across supported runtimes.
- Public registry compatibility evidence comes from exact-version registry smoke; local package
  compatibility evidence remains the offline packed-artifact consumer test.

## Compatibility Evidence Required

- Captured MCP discovery fixture.
- Captured allowed call fixture.
- Captured denied call fixture.
- Captured approval-required call fixture.
- Captured matcher-denial fixtures for ambiguous paths, ambiguous network targets, and free-form
  shell commands.
- Captured network allow and deny fixtures.
- Captured secret-sensitive allow and denial fixtures that use labels only and contain no raw secret
  value.
- Captured redaction fixture.
- CLI JSON output fixture.
- Library policy-parse fixture.
- Library decision-result fixture.
- Library audit JSONL formatter fixture.
- Runtime audit correlation fixture covering matched request/response routing and raw-ID absence.
- Library tool-call normalization fixture.
- Runtime live stdio smoke command evidence for the implemented local proxy path.
- Runtime ops-log fixture evidence for structured lifecycle metrics emitted by live `run`.
- Runtime session-result fixtures for approval rejection, approval hook error, approval timeout
  fail-closed behavior, client envelope sanitization, client ping error response denial, client ping
  payload response denial, discovery state replacement, duplicate pending client request id denial,
  duplicate pending server request id denial, duplicate discovery sanitization, malformed discovery
  sanitization, pending discovery id type preservation, JSON-RPC framing boundary denial, invalid
  JSON-RPC envelope shape denial, invalid upstream response shape denial, invalid upstream error
  object denial, unmatched response denial, client unsupported method denial, server envelope
  sanitization, upstream response envelope sanitization, server-origin unsupported method denial,
  server-origin ping missing-id denial, server-origin ping params denial, invalid server-origin ping
  response denial, invalid client request and notification envelope-shape denial, upstream error
  data redaction, upstream error message redaction, and upstream error extra field redaction.

The current evidence registry is `fixtures/compatibility/manifest.json`. Its top-level `target`
remains `local-stdio-mvp`, `transport` remains `stdio`, and `fixtureSource` remains
`synthetic-local` for the local evidence corpus. The `targets[]` registry records each
compatibility target separately so local synthetic evidence and external MCP evidence cannot be
mistaken for the same release scope.
`pnpm run compatibility` builds the workspace, verifies every manifest entry, compares the captured
CLI, library, and runtime session fixtures against the current implementation, and runs registered
runtime smoke evidence commands. Library fixtures must exercise the public parser, decision
evaluator, audit JSONL formatter, and tool-call normalizer through package exports instead of
only checking static JSON shape. Decision fixtures and audit-event fixtures must include stable
machine-readable decision evidence `code` values; the compatibility check rejects fixture evidence
that relies only on human-readable `reason` text. Manifest `path`, `policy`, `call`, and `envelope`
references, plus CLI evidence command `--policy` and `--input` paths, must be safe
repository-relative tracked files so local-only fixtures cannot satisfy compatibility evidence.
Approval-required library fixtures may explicitly record `approvalHookAvailable` in the manifest so
hook-present and hook-missing decisions are both checked.

The external MCP stdio client matrix is registered as `external-filesystem-stdio` and
`external-filesystem-python-stdio` in `fixtures/compatibility/manifest.json`. Separate manifests and
normalized summaries prove the JavaScript `@modelcontextprotocol/sdk@1.29.0` and Python
`mcp==1.28.1` clients against the pinned filesystem server. This is evidence for those two rows,
not arbitrary MCP client/server compatibility. Target registration does not change release scope by
itself.

ADR 0008 keeps those SDKs outside product workspace manifests and published artifacts. They are
independent compatibility witnesses only; passing a row does not turn its SDK into a supported
embedding API or runtime dependency.

The Codex host-configuration fixture separately pins `@openai/codex@0.144.4`, generates a
`codex-cli-json` descriptor, registers it under an isolated temporary `CODEX_HOME`, and verifies the
stdio command through `codex mcp get --json`. This proves the recorded configuration shape only;
it is not a live authenticated Codex tool-use or approval UX claim.

The Gemini host-configuration fixture pins `@google/gemini-cli@0.50.0`, executes a generated
`gemini-cli-json` descriptor in an isolated temporary project and home, and verifies the stored
project-scoped stdio command. This is configuration-shape evidence only, not authenticated Gemini
tool use, workspace trust, or approval UX evidence.

## Review Blockers

- Public exports change without semver and migration notes.
- Compatibility claims lack runtime or consumer evidence.
- Package artifacts drift from documented public API.
- Package manifest compatibility drifts from `docs/library/package-surface.md`.
- `pnpm run compatibility` fails.
