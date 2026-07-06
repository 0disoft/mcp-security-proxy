# Product Brief

Status: Draft
Owner: 0disoft

## Purpose

MCP Security Proxy gives local AI agent hosts a small, inspectable security boundary in front of
MCP servers. It makes tool discovery and tool calls visible, policy-controlled, and auditable before
an agent can use file, shell, network, database, workflow, or secret-sensitive capabilities.

## Source of Truth

- Product decision: this document and docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md
- Origin idea: ../oss-ideas/ideas/devtools-ai/mcp-security-proxy.md

## Required Decisions

- Boundary: MCP protocol boundary policy and audit, not OS sandboxing.
- Data ownership: policy files, redacted audit events, and local configuration are user-owned.
- Failure and recovery behavior: deny unsafe or unclassified calls by default, return explainable
  MCP errors, and keep audit events useful without storing secrets.
- Validation needed before merge: VALIDATION.md

## Target Users

- MCP host and client implementers
- Local AI coding tool maintainers
- Developer platform teams that allow local MCP servers
- Security reviewers who need call-time evidence
- Power users with multiple local MCP servers

## Product Promise

The proxy should make it easy to answer four questions:

1. Which tools did this MCP server expose?
2. Which capabilities did the proxy infer or require policy for?
3. Why was this tool call allowed, denied, or marked for approval?
4. What safe audit evidence remains after redaction?

## Review Blockers

- The change claims complete sandboxing or malware prevention.
- The change logs raw secrets, environment values, prompt contents, or full tool arguments.
- The change allows file, shell, network, or secret-sensitive calls without an explicit policy path.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
