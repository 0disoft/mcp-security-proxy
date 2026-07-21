# HTTP Transport Compatibility Plan

Status: Draft

## Purpose

HTTP transport is a later compatibility target. The current implementation supports local stdio
only. This plan defines the minimum compatibility and safety gates required before any HTTP runtime,
HTTP CLI flag, hosted endpoint, or remote MCP server support can be claimed.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Runtime flow: docs/architecture/02-runtime-flow.md
- Method policy: docs/architecture/05-mcp-method-policy.md
- Data and privacy: docs/architecture/06-data-flow-and-privacy.md

## Non-Implementation Boundary

This document does not approve an HTTP server, HTTP client, hosted control plane, OAuth flow,
cookie handling, browser session bridge, or public endpoint. It records the acceptance plan only.
Any implementation must arrive through a later ADR that names the selected MCP specification
version, transport shape, dependency choices, public API changes, CLI surface, and release gates.

## Real-Demand Gate

HTTP work does not start merely because the stdio roadmap is complete or a new version is planned.
Before an implementation ADR is proposed, repository evidence must identify at least one concrete
consumer integration that cannot reasonably use the installed stdio proxy and must state which MCP
HTTP transport, deployment shape, authentication owner, and session model it requires.

The demand packet must also name an owner for the HTTP threat model and operations burden, an
independently maintained client/server fixture pair, and a bounded compatibility scenario that can
run without production credentials or public-internet availability. A feature request that only
asks for “remote MCP,” protocol completeness, or parity with another proxy does not satisfy this
gate. Until the packet and ADR exist, HTTP remains deferred and releases must continue to record it
as excluded scope.

## Transport Invariants

An HTTP transport must preserve the stdio runtime security contract:

- deny unsupported methods before forwarding;
- preserve request and response correlation by exact JSON-RPC id value and type;
- enforce the same method direction policy;
- rebuild request envelopes and response envelopes before forwarding;
- filter discovery results before a client can see them;
- evaluate tool calls before forwarding them;
- require host approval before forwarding approval-required calls;
- redact upstream error details before forwarding or auditing;
- avoid raw tool arguments, raw prompts, secrets, and environment values in audit events;
- keep audit write failure fail-closed unless policy explicitly records a weaker mode.

## HTTP-Specific Risks

HTTP adds risks that stdio does not own:

- authentication, authorization, cookies, bearer tokens, and header privacy;
- cross-origin requests, browser preflight behavior, and origin confusion;
- streaming response boundaries, reconnects, partial messages, and duplicate delivery;
- request cancellation, timeouts, retries, and idempotency;
- multi-client session isolation;
- remote server identity and endpoint pinning;
- proxy, load balancer, and log collector header capture;
- request body size limits, decompression limits, and backpressure;
- TLS and certificate validation ownership;
- operator retention of HTTP access logs outside audit JSONL.

## Required Design Decisions

Before HTTP support is implemented, an ADR must decide:

- whether the runtime is an HTTP client proxy, HTTP server, or both;
- whether streaming is supported, and how one JSON-RPC message boundary is identified;
- how sessions are identified without leaking credentials or mixing clients;
- which headers are forwarded, stripped, redacted, or never accepted;
- how authentication material enters the runtime without being logged;
- how request cancellation, timeout, retry, and duplicate delivery are handled;
- how audit events identify transport context without storing tokens, cookies, IP addresses, or
  raw headers;
- whether the CLI owns any HTTP flags or whether HTTP is library-only first.

## Compatibility Evidence Required

HTTP compatibility must be fixture-backed before release claims. Minimum evidence:

- captured HTTP request and response fixtures for `initialize`, `ping`, `tools/list`, and
  `tools/call`;
- unsupported-method denial over HTTP;
- discovery filtering over HTTP;
- allowed, denied, and approval-required tool-call decisions over HTTP;
- upstream error redaction over HTTP;
- malformed body, oversized body, decompression, partial-stream, reconnect, timeout, and duplicate
  delivery behavior;
- header allowlist and redaction fixtures;
- audit JSONL fixtures that prove no raw credentials, cookies, raw headers, raw prompts, or raw tool
  arguments are stored.

## Release Gate

HTTP support remains blocked until:

- the HTTP ADR is approved;
- public API and CLI docs name the exact supported HTTP surface;
- package-surface and migration docs describe any new exports or commands;
- compatibility fixtures are registered in `fixtures/compatibility/manifest.json`;
- `docs`, `schema-contract`, `migration-check`, `package-surface`, `secret-scan`,
  `artifact-safety`, `repository-hygiene`, `validation-registry`, `ci-contract`, `compatibility`,
  `performance-smoke`, `smoke`, and `check` pass;
- the release record names HTTP support as included or explicitly excluded.

## Current Status

HTTP transport is not implemented. The repository may discuss HTTP only as a future compatibility
target until the gates above are satisfied.
