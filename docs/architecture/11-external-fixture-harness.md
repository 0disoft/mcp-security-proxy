# External Fixture Harness

Status: Draft

## Purpose

Define the harness boundary for the external MCP stdio client matrix selected by ADR 0005 and ADR
0007.

This document owns harness design; tracked manifests and summaries own current fixture evidence.

## Source of Truth

- Product decision: docs/product/02-spec.md
- External target ADR: docs/adr/0005-external-mcp-compatibility-target.md
- External client matrix ADR: docs/adr/0007-external-client-compatibility-matrix.md
- External compatibility plan: docs/architecture/09-external-mcp-compatibility-plan.md
- Compatibility registry: fixtures/compatibility/manifest.json
- Artifact safety policy: scripts/check-artifact-safety.mjs

## Harness Boundary

The harnesses exercise the pinned external target set from ADR 0005 and the client matrix from ADR
0007:

- `@modelcontextprotocol/sdk@1.29.0`
- Python `mcp==1.28.1` on Python 3.11.15
- `@modelcontextprotocol/server-filesystem@2026.7.4`
- stdio transport only

The harness must not add these packages as runtime dependencies of MCP Security Proxy. Any package
installation used to capture fixture evidence must be dev-only or ephemeral, pinned by exact
version, and excluded from distributed package manifests until a release readiness record approves a
different posture.

The existing `fixtures/compatibility/manifest.json` keeps the top-level `local-stdio-mvp` fields
for the local synthetic evidence set and uses `targets[]` as the multi-target registry. External
fixture work stays in separate `external-filesystem-stdio` and
`external-filesystem-python-stdio` target entries with their own manifests, summaries, harnesses,
and validation commands. Do not merge external evidence into the local
`evidence[]` corpus or use it as release-scope evidence unless the release record explicitly
includes external MCP compatibility.

## Execution Model

The harness should run as a non-interactive Node.js script under `scripts/` and should:

1. Create a temporary fixture root with only synthetic public-safe files.
2. Create a temporary policy that allows only the synthetic public directory and denies sibling
   paths in the same temporary root.
3. Start `mcp-security-proxy run` with that temporary policy.
4. Start the external filesystem server behind the proxy with the synthetic temporary root.
5. Drive equivalent sessions with the external TypeScript and Python SDK stdio clients.
6. Capture only normalized, public-safe result summaries and redacted audit events.
7. Delete the temporary fixture root after the run, whether the harness passes or fails.

The tracked output must normalize dynamic values before comparison:

- timestamps become `<timestamp>`;
- elapsed durations become `0`;
- process ids become `<pid>`;
- temporary roots become `<external-fixture-root>`;
- platform path separators become POSIX `/` in tracked fixture files.

## Minimum Scenario Set

The first harness implementation should prove the narrow path before expanding coverage:

- initialize succeeds through the proxy;
- `notifications/initialized` is accepted in the expected order;
- `tools/list` is filtered before the SDK client sees tools;
- a read under `<external-fixture-root>/public` is allowed;
- a read under `<external-fixture-root>/private` is denied by policy before upstream forwarding;
- a direct call to a tool hidden by filtered discovery is denied;
- orderly client transport shutdown completes;
- redacted audit JSONL contains decision evidence codes without raw tool arguments.

Malformed upstream response, unmatched response, and server-origin request coverage may be added
later if the external target can produce those cases without private hooks or brittle process
patching. If it cannot, the fixture evidence must record an explicit exclusion and keep synthetic
local fixtures as the regression source for those failure modes.

## Safety Rules

Tracked external compatibility fixtures must not contain:

- real home directory paths;
- private repository paths;
- raw environment values;
- credentials, tokens, cookies, private keys, or secret-like strings;
- raw prompt text;
- full tool arguments;
- raw upstream stderr lines;
- local npm cache paths;
- package-manager debug logs.

The harness may store raw protocol frames only in temporary process memory. Tracked evidence must be
normalized into a bounded summary format before it reaches `fixtures/compatibility/`.

## Validation Contract

The matrix validates this contract with `node scripts/check-external-mcp-fixture.mjs` and
`node scripts/check-external-python-mcp-fixture.mjs` after the workspace has been built. The scripts
create ephemeral npm and Python environments, install exact direct package versions, run the proxy
against the external filesystem server, and compare separate normalized summaries.

The first implementation should add validation in this order:

1. Add a harness script that can run locally with exact pinned external package versions.
2. Add a bounded tracked fixture summary under `fixtures/compatibility/`.
3. Extend compatibility validation with an explicit external target contract instead of weakening
   the current local manifest checks.
4. Extend artifact-safety checks to reject unnormalized temporary roots, local home paths, npm
   cache paths, and package-manager logs in external fixture evidence.
5. Keep `docs`, `secret-scan`, `artifact-safety`, `repository-hygiene`, `compatibility`, `smoke`,
   and `check` passing before changing any release record to include external MCP compatibility.

## Review Blockers

- The harness uses unpinned external package versions.
- The harness writes external packages into runtime dependencies.
- The Python harness reads user pip/npm credentials or adds Python to product runtime requirements.
- The harness stores raw protocol frames, raw tool arguments, private paths, or package-manager logs
  in tracked files.
- The harness broadens the local compatibility manifest without a multi-target validation contract.
- The harness claims external MCP compatibility before fixture evidence is tracked and validated.
