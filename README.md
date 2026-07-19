# MCP Security Proxy

Status: Draft
Scope: general
Repository Type: cli-tool
Addons: library

MCP Security Proxy is a local policy boundary for Model Context Protocol servers. It runs in front
of one or more MCP servers, filters tool discovery, evaluates tool calls against explicit policy,
redacts sensitive audit fields, and records what was allowed or denied.

The project starts as a CLI and reusable library. The CLI should make local experimentation and
host integration easy. The library should let editors, CLI agents, and internal agent runners embed
the same policy and audit behavior without shelling out.

This is not an OS sandbox. It cannot stop a server process from doing work outside MCP messages.
Its job is narrower and sharper: inspect the MCP protocol boundary before an agent gets a tool or
before a tool call leaves the host.

## Quick Start

Node.js 24 or newer is required. Install the published CLI and the pinned filesystem MCP server:

```sh
npm install --global @0disoft/mcp-security-proxy-cli@0.2.0-alpha.3 @modelcontextprotocol/server-filesystem@2026.7.4
```

Then follow the [npm CLI Quick Start](packages/cli/README.md#quick-start) to create a deny-by-default
policy, validate it, and generate or apply a host registration. The example exposes only
`read_text_file` under one explicit lexical path. It does not turn the filesystem server into an OS
sandbox or protect against symlink and junction escapes outside the MCP argument boundary.

## Source Files

- AGENTS.md: agent working rules
- CHECKLIST.md: checklist router
- VALIDATION.md: validation names and reporting requirements
- .agents/context-map.md: agent route map
- docs/: design, operations, architecture, and engineering standards

## Initial Product Direction

Implemented foundation:

- stdio MCP proxy through `mcp-security-proxy run`
- deny-by-default sample policy
- explicit MCP method allowlist
- tool list filtering
- tool call allow/deny decisions
- path, command, and argument-level network policy matching
- upstream error data and sensitive error-message redaction
- JSON Lines audit events
- dry-run policy evaluation through `check-policy`, `inspect-tools`, and `eval-call`
- read-only `config-snippet --target stdio-json` output with policy/profile validation and exact
  upstream argv preservation
- read-only Codex registration descriptors verified with a pinned Codex CLI and isolated temporary
  `CODEX_HOME`
- read-only project-scoped Gemini registration descriptors verified with a pinned Gemini CLI,
  temporary home, and temporary project
- bounded JSON-RPC frame size and parsed depth guards
- stable decision evidence codes for audit consumers
- embeddable runtime approval hook API for approval-required tool calls

Still intentionally narrow:

- only stdio transport is implemented
- network policy is argument-level intent policy, not OS socket enforcement
- CLI `run` does not bundle an approval UI; approval hooks are for embedding hosts
- the five `0.2.0-alpha.2` packages are published to npm with provenance; `0.2.0-alpha.3` is the
  approved candidate and remains unpublished until its release workflow succeeds
- product packages intentionally remain MCP SDK-free; pinned SDKs are used only as isolated
  external compatibility clients

## Non-Goals

- Replacing OS sandboxing, containers, or endpoint security
- Hosting an MCP server marketplace
- Building an agent runtime
- Storing secrets or raw tool arguments in audit logs
- Supporting every MCP transport in the first version
- Claiming to block network sockets or file access that bypasses MCP messages

## Repository Hygiene

.editorconfig, .gitattributes, and .gitignore are generated to keep line endings,
binary diffs, local files, build outputs, caches, and secret files under control.

## License and Security

This repository is licensed under Apache-2.0. Security reporting and public/private data boundaries
are documented in SECURITY.md.

## Scope Notes

Implementation direction is TypeScript with pnpm, recorded in
docs/adr/0004-implementation-stack-direction.md. The current scaffold targets Node.js `>=24.0.0`
and keeps the root workspace and testkit private. The approved `0.2.0-alpha.3` candidate record
names the five public npm packages and artifact boundaries; the latest completed publication
receipt remains `0.2.0-alpha.2`. ADR 0008 keeps product packages independent from
MCP SDK runtime dependencies. The pinned external stdio client matrix is recorded in
docs/adr/0007-external-client-compatibility-matrix.md and backed by tracked JavaScript and Python
client fixture evidence. It is not a claim of compatibility with arbitrary MCP clients or servers.
