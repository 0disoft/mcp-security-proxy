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

## Source Files

- AGENTS.md: agent working rules
- CHECKLIST.md: checklist router
- VALIDATION.md: validation names and reporting requirements
- .agents/context-map.md: agent route map
- docs/: design, operations, architecture, and engineering standards

## Initial Product Direction

- stdio MCP proxy first
- deny-by-default sample policy
- tool list filtering
- tool call allow/deny decisions
- path scope matching
- command allowlist matching
- network policy expression
- environment and secret redaction
- JSON Lines audit events
- dry-run policy evaluation

## Non-Goals

- Replacing OS sandboxing, containers, or endpoint security
- Hosting an MCP server marketplace
- Building an agent runtime
- Storing secrets or raw tool arguments in audit logs
- Supporting every MCP transport in the first version

## Repository Hygiene

.editorconfig, .gitattributes, and .gitignore are generated to keep line endings,
binary diffs, local files, build outputs, caches, and secret files under control.

## Scope Notes

Implementation language, package manager, distribution target, and MCP SDK choices remain UNDECIDED
until recorded in ADRs and synchronized with the CLI and library contracts.
