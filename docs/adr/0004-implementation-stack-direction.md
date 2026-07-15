# Implementation Stack Direction

Status: Accepted
Owner: 0disoft

The TypeScript, pnpm, and Node.js decisions remain active. Public package publication was settled by
the `0.2.0-alpha.1` release record, and the runtime MCP SDK boundary is settled by
docs/adr/0008-runtime-mcp-sdk-boundary.md.

## Decision

MCP Security Proxy uses TypeScript and pnpm for the first code scaffold.

The initial Node.js runtime floor is `>=24.0.0`, verified against current official Node.js release
status before package metadata was added.

Workspace package names are internal and private for now:

- `@0disoft/mcp-security-proxy-contracts`
- `@0disoft/mcp-security-proxy-core`
- `@0disoft/mcp-security-proxy-mcp-adapter`
- `@0disoft/mcp-security-proxy-runtime`
- `@0disoft/mcp-security-proxy-cli`
- `@0disoft/mcp-security-proxy-testkit`

The workspace package names became the five public product packages plus private testkit through
the approved `0.2.0-alpha.1` release record. MCP SDK use is excluded from product package manifests
by ADR 0008.

## Context

The first product shape is a local CLI plus embeddable library. TypeScript is a practical default
for MCP ecosystem compatibility, JSON schema work, CLI distribution, and broad OSS contribution.
pnpm is a practical default for a future workspace layout where contracts, core policy logic,
adapter code, runtime code, CLI code, and testkit code may evolve together.

The project should not lock a Node.js version from memory. Runtime floors affect installation,
CI, package metadata, and user support, so the exact version must be verified against current
official release status before package files or workflows are created.

## Consequences

- Documentation may describe TypeScript, pnpm, and Node.js `>=24.0.0` as the current scaffold
  baseline.
- Package publication names and artifacts are owned by release-readiness records.
- Product package manifests remain MCP SDK-free under ADR 0008; external compatibility fixtures
  may use pinned SDK clients in isolated temporary environments.
- Core policy logic should remain independent from filesystem, subprocess, network, and SDK IO so
  future host embedding or language-port options stay open.

## Review Blockers

- The change pins a Node.js floor without current-version verification.
- The change adds package metadata, CI, or dependency constraints that conflict with this ADR.
- The change imports MCP SDK into a workspace package contrary to ADR 0008.
- The change alters public package names outside release-readiness evidence.
