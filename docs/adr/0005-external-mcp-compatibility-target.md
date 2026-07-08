# External MCP Compatibility Target

Status: Accepted
Owner: 0disoft

## Purpose

Select the first independently maintained MCP client and server implementations for external
stdio compatibility evidence.

This ADR does not claim external MCP compatibility by itself. It only selects the first target set
that future fixture capture and validation work must use before any release record can include
external MCP compatibility.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Compatibility plan: docs/architecture/09-external-mcp-compatibility-plan.md
- Runtime flow: docs/architecture/02-runtime-flow.md
- Method policy: docs/architecture/05-mcp-method-policy.md
- Related ADR: docs/adr/0004-implementation-stack-direction.md

## Decision

The first external MCP compatibility target set is:

- Client implementation: `@modelcontextprotocol/sdk` TypeScript client and stdio client transport,
  pinned to `1.29.0` for the first fixture capture.
- Server implementation: `@modelcontextprotocol/server-filesystem`, pinned to `2026.7.4` for the
  first fixture capture.
- Transport: stdio only.
- Installation source: npm registry packages resolved by exact package version.
- Fixture workspace: repository-owned temporary compatibility workspace containing only synthetic
  public-safe files created for the test run.

The target package versions above were checked on July 8, 2026 with:

- `npm view @modelcontextprotocol/sdk version dist-tags --json`
- `npm view @modelcontextprotocol/server-filesystem version dist-tags --json`

The repository-owned fixture harness may use the external TypeScript SDK client APIs to drive the
session, but that harness is not itself the compatibility target. The compatibility claim must stay
attached to the pinned external SDK client implementation and the pinned external filesystem
server implementation.

## Non-Implementation Boundary

This ADR does not add a runtime MCP SDK dependency to MCP Security Proxy. It does not approve
bundling an MCP SDK in product packages, importing SDK code into core policy logic, adding HTTP
transport, adding a hosted control plane, or using a real user filesystem capture.

Any future dev-only dependency or ephemeral install command used for fixture capture must stay out
of runtime package dependencies and must be covered by dependency, artifact-safety, and release
readiness checks.

## Required Fixture Evidence

Before external MCP compatibility can be claimed, the fixture work must add tracked, redacted, and
public-safe evidence for:

- initialization through the SDK client and filesystem server behind the proxy;
- `notifications/initialized` ordering through the proxy;
- `tools/list` filtering before the SDK client sees filesystem tools;
- an allowed filesystem read rooted in the synthetic public fixture directory;
- a denied filesystem read outside the allowed synthetic fixture directory;
- a direct call to a tool that was not visible after filtered discovery;
- upstream error redaction from the external filesystem server;
- malformed or unmatched response handling when the external target can be safely induced, or an
  explicit exclusion if the target cannot produce that behavior without private or brittle hooks;
- redacted audit JSONL output with no raw prompts, secrets, environment values, private paths, or
  full tool arguments;
- a compatibility manifest entry and validation command that replay or run the external target.

The fixture must not use real home directories, private repositories, private policy files, real
operator logs, raw incident evidence, credentials, tokens, cookies, or environment values.

## Release Gate

`fixtures/compatibility/manifest.json` must continue to record only the local synthetic target
until the external fixture evidence above exists and passes validation.

A release record may include external MCP compatibility only after:

- the manifest records the external target set separately from `local-stdio-mvp`;
- docs name the exact client package, server package, versions, transport, and fixture scope;
- `docs`, `schema-contract`, `migration-check`, `package-surface`, `secret-scan`,
  `artifact-safety`, `repository-hygiene`, `validation-registry`, `ci-contract`,
  `compatibility`, `performance-smoke`, `smoke`, and `check` pass;
- the release record includes external MCP fixtures instead of using the exclusion evidence path.

## Rejected Alternatives

- `@modelcontextprotocol/inspector` as the first client target: useful for manual investigation,
  but less suitable as the first deterministic non-interactive fixture target.
- Repository fixture server as an external target: already covered by local synthetic evidence and
  explicitly not independently maintained.
- HTTP external compatibility first: out of scope until the HTTP ADR and transport fixtures exist.
- A broad compatibility matrix first: too much surface before one narrow external stdio path is
  fixture-backed and repeatable.

## Review Blockers

- The change claims external MCP compatibility without tracked fixture evidence.
- The change uses unpinned external package versions for compatibility evidence.
- The change captures real user files, credentials, raw prompts, private paths, or private logs.
- The change adds an MCP SDK runtime dependency outside an ADR and release readiness record.
- The change treats this ADR as approval for HTTP transport or hosted control-plane behavior.
