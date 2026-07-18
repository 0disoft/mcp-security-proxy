# External MCP Compatibility Plan

Status: Draft

## Purpose

External MCP compatibility means this proxy has been checked against independently maintained MCP
client and server implementations, not only the synthetic local fixture server in this repository.
The current implementation proves a pinned two-client filesystem matrix, a second Python fetch
server row, and the local synthetic regression path. It does not claim compatibility with arbitrary MCP clients or servers.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Runtime flow: docs/architecture/02-runtime-flow.md
- Method policy: docs/architecture/05-mcp-method-policy.md
- First external target ADR: docs/adr/0005-external-mcp-compatibility-target.md
- External client matrix ADR: docs/adr/0007-external-client-compatibility-matrix.md
- Second external server ADR: docs/adr/0011-second-external-server-target.md
- External fixture harness: docs/architecture/11-external-fixture-harness.md
- Compatibility registry: fixtures/compatibility/manifest.json
- Release scope gate: docs/ops/release.md

## Non-Implementation Boundary

This document does not select an MCP SDK for product runtime dependency, package manager plugin, or
host runtime. ADR 0005 selects the first external stdio pair, ADR 0007 selects the two-client
filesystem matrix, and ADR 0011 selects the second external server. External compatibility claims
still require tracked fixture evidence and a release record that names the clients and servers,
exact versions, transport mode, installation source, fixture capture method, and validation
commands.

Do not treat the repository fixture server as an external MCP server. It is a synthetic regression
fixture for the local stdio MVP.

## Compatibility Invariants

External MCP fixtures must preserve the same security contract as the local stdio path:

- initialize and initialized ordering remains compatible with the chosen client and server;
- tool discovery is filtered before the client sees it;
- allowed tool calls are forwarded only after discovery makes the tool visible;
- denied and approval-required tool calls are not forwarded upstream;
- request and response ids are correlated by exact JSON-RPC value and type;
- server-origin requests are direction-checked before forwarding;
- non-standard request and response envelope fields are removed before forwarding;
- malformed, unmatched, oversized, or too-deep messages are dropped or denied without leaking raw
  payloads into client output or audit logs;
- upstream error details are redacted before client output or audit writes;
- audit output contains decision evidence and redaction counts without raw prompts, secrets,
  environment values, full tool arguments, or raw upstream stderr lines.

## Compatibility Evidence Required

External MCP compatibility must be fixture-backed before release claims. Minimum evidence:

- selected MCP client and server names, versions, installation sources, and transport modes;
- captured initialize, notifications/initialized, tools/list, and tools/call transcripts;
- captured allowed, denied, and approval-required tool-call behavior;
- captured upstream error, malformed response, unmatched response, and server-origin request cases
  when the external target can safely produce them, otherwise an explicit exclusion backed by
  synthetic-local regression evidence;
- redacted audit JSONL fixtures for each security-sensitive path;
- a replay or live smoke command registered under the matching target in
  `fixtures/compatibility/manifest.json`;
- artifact-safety evidence proving captured fixtures are synthetic or public-safe and contain no
  real credentials, private logs, raw prompts, or raw incident evidence.

## Release Gate

External MCP compatibility support remains blocked until:

- the external fixture target set is approved;
- the MCP SDK dependency choice is either explicitly included or excluded in the release record;
- docs name the exact compatible client/server versions and transport mode;
- compatibility fixtures are registered in `fixtures/compatibility/manifest.json`;
- `docs`, `schema-contract`, `migration-check`, `package-surface`, `secret-scan`,
  `artifact-safety`, `repository-hygiene`, `validation-registry`, `ci-contract`, `compatibility`,
  `performance-smoke`, `smoke`, and `check` pass;
- the release record names external MCP compatibility fixtures as included or explicitly excluded.

## Current Status

ADR 0007 records two external client rows against the same pinned filesystem server:
`@modelcontextprotocol/sdk@1.29.0` and Python `mcp==1.28.1`, both against
`@modelcontextprotocol/server-filesystem@2026.7.4`. The `external-filesystem-stdio` and
`external-filesystem-python-stdio` harness fixtures now exist as separate targets. The compatibility
registry also records `external-fetch-stdio`, which drives `mcp-server-fetch==2026.7.10` with the
JavaScript SDK client against a harness-owned loopback HTTP endpoint. It proves an allowed local
fetch, a denied external IP target, normalized upstream HTTP failure, and redacted audit evidence.
Local synthetic evidence remains under the top-level `local-stdio-mvp` fields, and every external
row records its pinned client, server, harness, summary, and validation command in `targets[]`.
Registry presence alone is still not a broad compatibility claim; release evidence must name the
pinned rows and retain their explicit exclusions.
