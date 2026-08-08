# Agent Plugins compatibility evidence

Status: proof of concept
Checked: 2026-08-08

## Scope

This evidence covers only the tracked `agent-plugin/` directory and the user-supplied Agent Plugins
1.0.0 snapshot. The official schema was not refreshed live during this change, so this is local
structural compatibility evidence rather than a claim of current marketplace acceptance.

## Result

- `plugin.json` exposes the published CLI version and public package metadata.
- `mcp.json` contains one repository-local stdio MCP server entry.
- The entry invokes the built proxy with the tracked deny-by-default local policy and fixture server.
- No environment map, credential, token, raw secret, or host configuration write is included.
- Existing MCP policy, redaction, audit, and process-containment behavior remains authoritative.

## Distribution boundary

The PoC depends on repository-relative build, policy, fixture, and audit paths and therefore is not
distribution-ready. Packaging it for external consumers would require an explicit upstream server
contract, packaged policy assets, runtime path resolution independent of the repository checkout,
a user-owned writable audit destination, and validation against a freshly retrieved official schema.

## Validation

`pnpm run compatibility` builds the workspace, validates existing compatibility evidence, and then
checks the PoC manifest, MCP entry, source paths, version parity, secret-free shape, and documented
provenance boundary.
