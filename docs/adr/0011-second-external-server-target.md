# Second External MCP Server Target

Status: Accepted
Owner: 0disoft

## Purpose

Add a second independently packaged MCP server implementation to the stdio compatibility evidence
without turning three pinned rows into an arbitrary compatibility claim.

## Source of Truth

- External compatibility plan: docs/architecture/09-external-mcp-compatibility-plan.md
- Existing client matrix: docs/adr/0007-external-client-compatibility-matrix.md
- Runtime SDK boundary: docs/adr/0008-runtime-mcp-sdk-boundary.md
- Harness boundary: docs/architecture/11-external-fixture-harness.md
- Compatibility registry: fixtures/compatibility/manifest.json

## Decision

The second external server target is `mcp-server-fetch==2026.7.10` from PyPI, driven by
`@modelcontextprotocol/sdk@1.29.0` over stdio on Node.js 24 and Python 3.11.15. The target id is
`external-fetch-stdio`.

The package is MIT licensed, requires Python 3.10 or newer, and is installed only into an isolated
temporary virtual environment with an exact direct version. The Node client SDK is likewise
installed only into the temporary fixture workspace. Neither package enters a workspace manifest,
published tarball, or product runtime API.

The target adds a different implementation and behavior axis from the filesystem server:

- Python server process and Python MCP server stack behind a JavaScript MCP client;
- a network-classified `fetch` tool instead of filesystem path tools;
- an allowed fetch against a harness-owned loopback HTTP endpoint;
- a denied external IP target that must not reach the server;
- normalized upstream HTTP error behavior from the loopback endpoint;
- orderly shutdown and redacted audit evidence without temporary paths or raw arguments.

The tracked summary records only stable booleans, tool names, decision codes, content types, and a
synthetic content digest. Dynamic ports, raw URLs, raw server errors, protocol transcripts,
temporary paths, environment values, and package-manager output are not retained.

## Alternatives Rejected

- Another filesystem client row: it would add no independent server behavior.
- `mcp-server-time`: its tools classify as `unknown` under the current fail-closed capability
  heuristic, so it cannot prove an allowed call without a separate policy capability-override
  design.
- `server-everything`: useful as a protocol exerciser but shares the TypeScript reference-server
  lineage and adds a broad, noisy surface before a focused second server.
- A credential-backed or public-internet fixture: it would make CI depend on secrets, remote
  service state, rate limits, and data-handling policy unrelated to this compatibility goal.
- HTTP MCP transport: still deferred by the HTTP transport plan. The loopback HTTP endpoint here is
  only synthetic content fetched by a stdio MCP server.

## Consequences

- The ordinary external compatibility gate now depends on npm and PyPI availability plus Python
  wheels for the pinned target.
- Exact direct versions are fixed, but transitive Python and npm resolution can still drift and
  must be reviewed when the normalized fixture changes.
- A passing row proves only the recorded stdio scenarios for the exact client/server versions.

## Rollback

Remove the `external-fetch-stdio` registry row, its manifest and summary, its harness invocation,
and the synchronized documentation. Do not rewrite historical release records to claim or remove
evidence retroactively.

## Review Blockers

- The server is installed into a product or workspace dependency group.
- The harness reads user pip/npm configuration or registry credentials.
- The fixture contacts public internet or retains dynamic ports, raw URLs, errors, environment
  values, temporary paths, or protocol frames.
- Documentation calls the three pinned rows arbitrary MCP compatibility.
