# External MCP Compatibility Evidence

Status: Draft

## Operational Contract

This document records release-scope evidence for the first external MCP stdio compatibility target.
It is evidence for one pinned client/server pair, not a broad external MCP compatibility matrix.

## Owners

- Primary owner: 0disoft
- Backup owner: 0disoft for repository-owned fixture evidence; local operators for any local
  package-manager cache or network access used while rerunning the harness
- Escalation path: SECURITY.md for sensitive evidence; repository issues for non-sensitive fixture
  drift

## Target Scope

The external target is registered as `external-filesystem-stdio` in
`fixtures/compatibility/manifest.json`.

- Client implementation: `@modelcontextprotocol/sdk` version `1.29.0`
- Server implementation: `@modelcontextprotocol/server-filesystem` version `2026.7.4`
- Transport: stdio only
- Installation source: npm registry packages resolved by exact version during the ephemeral
  harness run
- Fixture workspace: temporary synthetic public-safe files created by
  `scripts/check-external-mcp-fixture.mjs`

The harness may use the external SDK client APIs to drive the session, but the product packages do
not add an MCP SDK runtime dependency.

## Tracked Evidence

The release-scope evidence is bounded to tracked, normalized files:

- Registry target: `fixtures/compatibility/manifest.json`
- External target manifest: `fixtures/compatibility/external-filesystem-stdio.manifest.json`
- Normalized summary: `fixtures/compatibility/external-filesystem-stdio.summary.json`
- Harness command: `node scripts/check-external-mcp-fixture.mjs`
- Target selection ADR: `docs/adr/0005-external-mcp-compatibility-target.md`
- Harness boundary: `docs/architecture/11-external-fixture-harness.md`

The normalized summary uses `<external-fixture-root>`, `<timestamp>`, and `0` elapsed durations so
tracked evidence does not include local temp paths, process details, or timing noise.

## Scenario Evidence

The tracked summary proves these scenarios for the pinned external filesystem target:

- SDK client initialization succeeds through the proxy.
- `notifications/initialized` is accepted in the expected order.
- `tools/list` is filtered before the SDK client sees the filesystem tools.
- `read_text_file` remains visible after filtering.
- `list_allowed_directories` is hidden after filtering.
- A read under the synthetic public fixture directory is allowed.
- A read outside the allowed synthetic public directory is denied before upstream forwarding.
- A direct call to a hidden tool is denied with `tool.not_visible`.
- Redacted audit evidence includes `discovery.filtered`, `policy.rule_allow`,
  `policy.rule_deny`, and `tool.not_visible`.
- The tracked audit summary does not contain the raw external fixture root.

## Validation Evidence Required

A release record may use this document as non-exclusion evidence only when it separately records
approval-grade validation output for the target commit. At minimum, record exit 0 evidence for:

- `pnpm run compatibility`
- `pnpm run artifact-safety`
- `pnpm run release-readiness`
- `pnpm build` followed by `node scripts/check-external-mcp-fixture.mjs`
- `pnpm check`

The release record still owns the exact command output summary, target commit, package posture, and
rollback evidence. This document does not approve a public package release by itself.

## Explicit Exclusions

This evidence does not claim:

- HTTP transport compatibility;
- host-specific approval UX;
- a product runtime dependency on `@modelcontextprotocol/sdk`;
- compatibility with arbitrary MCP clients or servers;
- a general OS sandbox, filesystem sandbox, malware scanner, or hosted control plane;
- malformed response, unmatched response, or server-origin request coverage from the external
  filesystem target when those cases require brittle private hooks.

Synthetic local fixtures remain the regression source for malformed envelopes, unmatched responses,
server-origin request direction checks, upstream error redaction edge cases, frame guards, and
JSON-RPC id correlation edge cases that the external filesystem target cannot safely produce.

## Release Use

If a release record includes external MCP compatibility, its `releaseScope.externalMcpFixture`
evidence may point to this document instead of the exclusion plan. The release record must keep
`httpTransport` and `hostApprovalUx` excluded unless their own implementation and fixture evidence
exist.
