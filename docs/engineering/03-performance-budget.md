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
- newline-delimited JSON-RPC frame validation

## Draft Budgets

Implemented live stdio frame guards:

- default maximum JSON-RPC line size: 1048576 UTF-8 bytes
- CLI-supported maximum JSON-RPC line size: 16777216 UTF-8 bytes
- default parsed JSON depth: 64
- CLI-supported maximum parsed JSON depth: 256

Other exact latency and memory numbers are UNDECIDED until broader compatibility fixtures exist, but
the implementation must measure:

- policy parse time at startup
- per-tool descriptor classification time during discovery
- per-call evaluation latency
- redaction latency for bounded summaries
- audit write latency and failure behavior
- memory growth while proxying long sessions

## Local Smoke Budgets

`pnpm run performance-smoke` is not a production SLO. It is a local regression guard for the current
small fixture corpus. It must pass these bounded hot-path checks on the supported Node.js runtime:

- policy parse and validation: 100 iterations within 2000 ms total
- tool descriptor classification: 1000 iterations within 2000 ms total
- tool-call evaluation: 1000 iterations within 2000 ms total
- redaction summary generation: 1000 iterations within 2000 ms total
- audit event formatting: 1000 iterations within 2000 ms total

These budgets are intentionally loose. They are meant to catch accidental repeated IO,
unbounded payload retention, or expensive work in core policy paths before public release.

## Engineering Rules

- Do not perform filesystem, subprocess, network, or SDK IO inside the core evaluator.
- Do not store unbounded raw MCP payloads for later audit processing.
- Reject frames that exceed configured size or parsed-depth limits before forwarding.
- Do not introduce repeated policy parsing on every tool call.
- Cache only deterministic derived policy structures, and document invalidation before reload support.
- Treat slow audit sinks as a fail-closed or explicitly warn-and-continue policy decision.

## Review Blockers

- The change adds repeated IO to the tool-call hot path.
- The change stores raw payloads to achieve delayed redaction.
- The change claims performance compatibility without fixtures or measurement.
- `pnpm run performance-smoke` fails for changed hot-path behavior.
- The change weakens validation or hides skipped checks.
