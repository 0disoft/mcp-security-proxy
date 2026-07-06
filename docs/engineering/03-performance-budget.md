# Performance Budget

Status: Draft

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related checklist: .agents/checklists/performance.md

## Hot Paths

- MCP method dispatch
- `tools/list` filtering
- `tools/call` fact normalization
- policy evaluation
- redaction summary generation
- audit event formatting and write

## Draft Budgets

Exact numbers are UNDECIDED until implementation exists, but the first implementation must measure:

- policy parse time at startup
- per-tool descriptor classification time during discovery
- per-call evaluation latency
- redaction latency for bounded summaries
- audit write latency and failure behavior
- memory growth while proxying long sessions

## Engineering Rules

- Do not perform filesystem, subprocess, network, or SDK IO inside the core evaluator.
- Do not store unbounded raw MCP payloads for later audit processing.
- Do not introduce repeated policy parsing on every tool call.
- Cache only deterministic derived policy structures, and document invalidation before reload support.
- Treat slow audit sinks as a fail-closed or explicitly warn-and-continue policy decision.

## Review Blockers

- The change adds repeated IO to the tool-call hot path.
- The change stores raw payloads to achieve delayed redaction.
- The change claims performance compatibility without fixtures or measurement.
- The change weakens validation or hides skipped checks.
