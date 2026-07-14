# External Client Compatibility Matrix

Status: Accepted
Owner: 0disoft

## Purpose

Expand external stdio evidence from one JavaScript client/server pair to two independently
implemented MCP clients without turning a narrow fixture set into an arbitrary compatibility claim.

## Source of Truth

- First external target: docs/adr/0005-external-mcp-compatibility-target.md
- Compatibility plan: docs/architecture/09-external-mcp-compatibility-plan.md
- Harness boundary: docs/architecture/11-external-fixture-harness.md
- Evidence registry: fixtures/compatibility/manifest.json
- Release evidence: docs/ops/external-mcp-compatibility-evidence.md

## Decision

The stdio external-client matrix uses one pinned external filesystem server and two pinned client
implementations:

| Target | Client | Server | Host runtime |
| --- | --- | --- | --- |
| `external-filesystem-stdio` | `@modelcontextprotocol/sdk@1.29.0` | `@modelcontextprotocol/server-filesystem@2026.7.4` | Node.js 24 |
| `external-filesystem-python-stdio` | `mcp==1.28.1` | `@modelcontextprotocol/server-filesystem@2026.7.4` | Python 3.11.15 plus Node.js 24 |

Holding the server constant isolates client implementation differences in initialization, stdio
framing, tool discovery, tool calls, error mapping, and orderly shutdown. Both rows must prove the
same normalized scenario contract and redaction boundary.

The npm and PyPI packages are installed only into temporary fixture environments with exact direct
versions. They are not product runtime dependencies and do not change the five published package
manifests. npm and pip user configuration and common registry credential environment variables are
excluded from fixture installs.

## Required Scenarios

Each row must prove:

- initialize and initialized completion;
- filtered `tools/list` visibility;
- an allowed synthetic public read;
- policy denial for a synthetic private read;
- direct hidden-tool denial with `tool.not_visible`;
- orderly client transport closure;
- redacted audit evidence without the raw temporary fixture root.

Malformed upstream responses, unmatched responses, server-origin requests, abrupt process death,
and HTTP transport remain synthetic-local or separately planned coverage. The pinned filesystem
server cannot produce those cases without private hooks, so this matrix must not claim them.

## CI and Release Boundary

The ordinary compatibility aggregate runs both external rows. Hosted CI and the release workflow
pin Python 3.11.15 for the Python row. Future release approvals created after this ADR must retain
both registered rows and their tracked manifests and summaries. Historical release records remain
bounded by their recorded target commit and must not be rewritten to claim later matrix evidence.

Adding another row requires an exact client/server version, a separate target id, normalized public
evidence, artifact-safety coverage, and documentation of what new implementation axis it adds.
Version-only duplication without a compatibility reason is not sufficient.

## Consequences

- Cross-implementation confidence is stronger than the original single JavaScript SDK pair.
- CI now depends on public npm and PyPI availability for external compatibility validation.
- Exact top-level versions are pinned, but transitive package resolution can still drift; fixture
  drift must be reviewed instead of blindly updating summaries.
- Two clients against one server are still not a broad client/server compatibility guarantee.

## Review Blockers

- Either matrix row is removed while release scope still claims included external fixtures.
- A fixture uses dist-tags, version ranges, user registry credentials, or tracked raw transcripts.
- Python becomes a product runtime dependency because it is used by the compatibility harness.
- Documentation calls this an arbitrary MCP compatibility matrix.
