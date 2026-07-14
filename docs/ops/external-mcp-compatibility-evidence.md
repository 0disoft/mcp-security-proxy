# External MCP Compatibility Evidence

Status: Draft

## Operational Contract

This document records release-scope evidence for the pinned external MCP stdio client matrix. It is
evidence for two client implementations against one server, not arbitrary MCP compatibility.

The `0.2.0-alpha.1` release record predates the Python row and remains evidence for only the original
JavaScript client pair at its recorded target commit. The two-client matrix applies to current HEAD
and future approval records; it does not retroactively broaden that historical release claim.

## Owners

- Primary owner: 0disoft
- Backup owner: 0disoft for repository-owned fixture evidence; local operators for any local
  package-manager cache or network access used while rerunning the harness
- Escalation path: SECURITY.md for sensitive evidence; repository issues for non-sensitive fixture
  drift

## Target Scope

The external targets are registered as `external-filesystem-stdio` and
`external-filesystem-python-stdio` in `fixtures/compatibility/manifest.json`.

- Client implementations: `@modelcontextprotocol/sdk` version `1.29.0` and Python `mcp` version
  `1.28.1`
- Server implementation: `@modelcontextprotocol/server-filesystem` version `2026.7.4`
- Transport: stdio only
- Installation source: npm and PyPI packages resolved by exact direct version during ephemeral
  harness runs
- Fixture workspace: temporary synthetic public-safe files created by
  `scripts/check-external-mcp-fixture.mjs` and
  `scripts/check-external-python-mcp-fixture.mjs`

The harness may use the external SDK client APIs to drive the session, but the product packages do
not add an MCP SDK runtime dependency.

## Tracked Evidence

The release-scope evidence is bounded to tracked, normalized files:

- Registry target: `fixtures/compatibility/manifest.json`
- External target manifest: `fixtures/compatibility/external-filesystem-stdio.manifest.json`
- Normalized summary: `fixtures/compatibility/external-filesystem-stdio.summary.json`
- Harness command: `node scripts/check-external-mcp-fixture.mjs`
- Python target manifest: `fixtures/compatibility/external-filesystem-python-stdio.manifest.json`
- Python normalized summary: `fixtures/compatibility/external-filesystem-python-stdio.summary.json`
- Python harness command: `node scripts/check-external-python-mcp-fixture.mjs`
- Target selection ADR: `docs/adr/0005-external-mcp-compatibility-target.md`
- Matrix ADR: `docs/adr/0007-external-client-compatibility-matrix.md`
- Harness boundary: `docs/architecture/11-external-fixture-harness.md`

The normalized summary uses `<external-fixture-root>`, `<timestamp>`, and `0` elapsed durations so
tracked evidence does not include local temp paths, process details, or timing noise.

## Scenario Evidence

Both tracked summaries prove these scenarios for the pinned external filesystem target:

- SDK client initialization succeeds through the proxy.
- `notifications/initialized` is accepted in the expected order.
- `tools/list` is filtered before the SDK client sees the filesystem tools.
- `read_text_file` remains visible after filtering.
- `list_allowed_directories` is hidden after filtering.
- A read under the synthetic public fixture directory is allowed.
- A read outside the allowed synthetic public directory is denied before upstream forwarding.
- A direct call to a hidden tool is denied with `tool.not_visible`.
- Orderly client transport shutdown completes.
- Redacted audit evidence includes `discovery.filtered`, `policy.rule_allow`,
  `policy.rule_deny`, and `tool.not_visible`.
- The tracked audit summary does not contain the raw external fixture root.

## Validation Evidence Required

A release record may use this document as non-exclusion evidence only when it separately records
approval-grade validation output for the target commit. At minimum, record exit 0 evidence for:

- `pnpm run compatibility`
- `pnpm run artifact-safety`
- `pnpm run release-readiness`
- `pnpm build` followed by both external harness commands
- Release workflow gate: `pnpm run external-compatibility`
- `pnpm check`

The release record still owns the exact command output summary, target commit, package posture, and
rollback evidence. This document does not approve a public package release by itself.

## Explicit Exclusions

This evidence does not claim:

- HTTP transport compatibility;
- host-specific approval UX;
- a product runtime dependency on either external client SDK or Python;
- compatibility with arbitrary MCP clients or servers;
- a general OS sandbox, filesystem sandbox, malware scanner, or hosted control plane;
- malformed response, unmatched response, or server-origin request coverage from the external
  filesystem target when those cases require brittle private hooks.

Synthetic local fixtures remain the regression source for malformed envelopes, unmatched responses,
server-origin request direction checks, upstream error redaction edge cases, frame guards, and
JSON-RPC id correlation edge cases that the external filesystem target cannot safely produce.
The exact upstream stderr line count is diagnostic only because package-manager, Python runtime,
and upstream startup notices are not part of the MCP behavior contract. Exact top-level client
versions are pinned, but transitive npm/PyPI dependency resolution remains a fixture-drift risk.

## Release Use

If a release record includes external MCP compatibility, its `releaseScope.externalMcpFixture`
evidence may point to this document instead of the exclusion plan. The release record must keep
`httpTransport` and `hostApprovalUx` excluded unless their own implementation and fixture evidence
exist.
