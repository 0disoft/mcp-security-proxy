# AGENTS.md

## Repository Scope

Scope: general

This repository owns the MCP Security Proxy project: a local proxy that sits in front of MCP
servers and applies policy to tool discovery and tool calls before an AI agent can use them.

It owns product requirements, architecture decisions, CLI contracts, library API contracts,
policy and audit-log semantics, compatibility notes, and future implementation source for this
tool when implementation work is explicitly requested.

It does not own a general OS sandbox, malware scanner, enterprise SIEM, secret manager, MCP server
marketplace, or full agent runtime.

## Repository Shape

Primary repository type: cli-tool
Addons: library

- cli-tool: owns proxy commands, policy dry-run commands, config loading, exit codes, terminal
  output, JSON output, and runtime compatibility.
- library: owns the reusable policy engine, MCP message inspection contracts, audit event types,
  package compatibility, semantic versioning, migration guidance, and public API surface.


## Source of Truth

- Product scope: docs/product/02-spec.md
- Architecture decisions: docs/adr/*.md
- Validation: VALIDATION.md
- Agent routing: .agents/context-map.md
- Repository hygiene: .editorconfig, .gitattributes, .gitignore

## Hard Rules

- Do not claim this proxy is a complete OS sandbox. It controls the MCP protocol boundary only.
- Do not claim that tool schemas prove safety. Tool classification must be treated as a heuristic
  unless backed by explicit policy.
- Do not store raw secrets, environment values, prompt contents, or tool arguments in audit logs.
- Default examples must be deny-by-default and must require explicit allow rules for file, shell,
  network, and secret-sensitive capabilities.
- Do not invent technology choices. Use UNDECIDED when a decision is not known.
- Do not create fake credentials, tokens, secrets, or private values.
- Do not rely on generated, cache, or build output as source truth.

## Repository Hygiene

- .editorconfig sets line ending, encoding, and final newline policy.
- .gitattributes sets Git text normalization and binary diff policy.
- .gitignore excludes local, secret, build, and cache artifacts.
- Generated, cache, and build output must not be used as design-document evidence.
- Do not create large diffs that only change line endings.

## Before Editing

- Read this file, VALIDATION.md, CHECKLIST.md, and .agents/context-map.md.
- Read the skill and checklist named by the context map.
- Confirm source-of-truth documents before changing contracts.

## Out of Scope

- Full OS sandboxing, container isolation, kernel enforcement, or process-level containment.
- Malware scanning and package reputation scoring.
- Secret storage, rotation, or key-management backends.
- MCP server marketplace, discovery catalog, or hosted control plane.
- Enterprise SIEM integrations beyond exportable JSON audit events.
- Project-specific credentials or deployment secrets.

## Final Response Requirements

- List executed validations, passed validations, skipped validations, skip reasons, and remaining risk.
- Name any source-of-truth documents changed.
- Call out API, DB, repository hygiene, and runner changes explicitly.
