# Approval Hooks

Status: Draft
Repository Type: library

## Repository Type Contract

This repository type owns public API surface, package compatibility, semantic versioning,
migration guidance, distribution artifacts, and consumer-facing deprecation policy.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Public API decision: docs/library/public-api.md
- Host UX boundary: docs/architecture/08-host-approval-ux-plan.md
- Runtime export: packages/proxy-runtime/src/session.ts
- Stdio bridge export: packages/proxy-runtime/src/stdio-bridge.ts

## API Surface

The runtime library exposes host-owned approval hooks for calls whose policy decision is
`approval_required`:

- `ApprovalRequest`: contains an opaque approval ID, profile ID, normalized tool call facts, the
  approval-required policy decision, and an abort signal.
- `ApprovalResult`: contains `approved` and an optional host-owned `reason`.
- `ApprovalHook`: accepts an `ApprovalRequest` and returns `ApprovalResult` or
  `Promise<ApprovalResult>`.
- `ProxySessionOptions.approvalTimeoutMs`: optional per-call timeout for async approval hooks.
- `StdioProxyOptions.approveToolCall`: optional hook used by the stdio bridge before forwarding
  approval-required calls.
- `StdioProxyOptions.approvalHookAvailable`: dry-run or embedding signal used when a real hook is
  not passed through the current call path.
- `runApprovalHookConformance`: runs the public hook-only conformance cases for explicit approval,
  rejection, hook error, abort handling, and concurrent request isolation.

## Hook Input Contract

Approval hooks receive normalized call facts and decision evidence only. The hook request must not
include the raw JSON-RPC envelope, raw MCP params object, raw prompt text, raw environment values,
or raw secret-bearing argument values.
Approval hook requests must not include the raw JSON-RPC envelope.

The current `ApprovalRequest` shape is:

```ts
interface ApprovalRequest {
  readonly approvalId: string;
  readonly profileId: string;
  readonly call: NormalizedToolCall;
  readonly decision: PolicyDecision;
  readonly signal: AbortSignal;
}
```

`call.argumentFacts` is a policy summary. Secret-like argument keys are reduced to labels such as
`api-key`, `token`, or `password` without retaining the raw value.
`approvalId` is an opaque per-call correlation value, not the raw JSON-RPC id. Hosts use it to keep
concurrent prompts and results isolated. The request, normalized call, decision, and their nested
arrays are frozen snapshots. `signal` aborts when the runtime timeout fires or the hook invocation
otherwise settles; hosts must close pending UI, listeners, and background work when it aborts.

## Hook Result Contract

The proxy forwards an approval-required call only when the hook returns an object whose `approved`
field is exactly boolean `true`. A missing, non-boolean, or otherwise malformed result fails closed.

All other outcomes fail closed without forwarding the call:

- `{ approved: false }`;
- hook rejection or thrown error;
- timeout through `approvalTimeoutMs`;
- missing hook in a path that requires one.

Host-provided rejection reasons are host-owned input. They are not forwarded or stored verbatim.
Approval hooks fail closed after 30 seconds unless an embedding host configures a shorter positive
timeout. Successful approval audit output records the final `allow` action with
`policy.approval_granted`. Audit and denial output use stable decision codes such as `policy.approval_denied`,
`policy.approval_hook_failed`, and `policy.approval_hook_missing`.

## Conformance Kit

Embedding hosts import `runApprovalHookConformance` from
`@0disoft/mcp-security-proxy-runtime`. The adapter's `createHook` function must return the host's real
hook wired to synthetic host controls for each scenario: `approve`, `reject`, `error`, `abort`, and
`concurrent`. The abort scenario must remain pending until `request.signal` aborts, then reject or
settle with `{ approved: false }`. The concurrent scenario receives two requests whose opaque IDs
end in `-approve` and `-reject`; the host harness must resolve them independently.

The returned `msp.approval-hook-conformance.v1` report contains stable case IDs and codes only. It
never includes hook rejection reasons or thrown error text. A passing report proves hook result,
cancellation, and correlation mechanics against the synthetic contract. It does not prove a host
UI's accessibility, prompt wording, persistence policy, audit integration, or production process
lifecycle; those still require host-specific fixture evidence and an ADR.

`settleTimeoutMs` bounds both scenario hook creation and non-abort hook settlement; a host adapter
that never returns cannot hang the conformance run. The report records setup failure or
`approval_hook.not_settled` without retaining host error details. `abortAfterMs` controls how long
the abort scenario must remain pending before the harness aborts it.

## Non-Goals

- No bundled approval UI.
- No persistent or remembered approval store.
- No host selection, browser extension API, editor API, or notification system.
- No raw MCP payload handoff to the hook.

## Review Blockers

- `ApprovalRequest` includes raw JSON-RPC, raw MCP params, prompt text, environment values, or raw
  secret-bearing argument values.
- Approval hook rejection reasons are forwarded or audited verbatim.
- Approval hooks ignore `signal` and leave timed-out prompts, listeners, or background work alive.
- Concurrent host prompts can reuse a result across different opaque `approvalId` values.
- Approval-required calls can be forwarded after timeout, rejection, hook error, or missing hook.
- Documentation describes a bundled approval UI or persistent approval store as implemented.
