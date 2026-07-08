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

- `ApprovalRequest`: contains the normalized tool call facts and the approval-required policy
  decision.
- `ApprovalResult`: contains `approved` and an optional host-owned `reason`.
- `ApprovalHook`: accepts an `ApprovalRequest` and returns `ApprovalResult` or
  `Promise<ApprovalResult>`.
- `ProxySessionOptions.approvalTimeoutMs`: optional per-call timeout for async approval hooks.
- `StdioProxyOptions.approveToolCall`: optional hook used by the stdio bridge before forwarding
  approval-required calls.
- `StdioProxyOptions.approvalHookAvailable`: dry-run or embedding signal used when a real hook is
  not passed through the current call path.

## Hook Input Contract

Approval hooks receive normalized call facts and decision evidence only. The hook request must not
include the raw JSON-RPC envelope, raw MCP params object, raw prompt text, raw environment values,
or raw secret-bearing argument values.
Approval hook requests must not include the raw JSON-RPC envelope.

The current `ApprovalRequest` shape is:

```ts
interface ApprovalRequest {
  readonly call: NormalizedToolCall;
  readonly decision: PolicyDecision;
}
```

`call.argumentFacts` is a policy summary. Secret-like argument keys are reduced to labels such as
`api-key`, `token`, or `password` without retaining the raw value.

## Hook Result Contract

The proxy forwards an approval-required call only when the hook returns `{ approved: true }`.

All other outcomes fail closed without forwarding the call:

- `{ approved: false }`;
- hook rejection or thrown error;
- timeout through `approvalTimeoutMs`;
- missing hook in a path that requires one.

Host-provided rejection reasons are host-owned input. They are not forwarded or stored verbatim.
Audit and denial output use stable decision codes such as `policy.approval_denied`,
`policy.approval_hook_failed`, and `policy.approval_hook_missing`.

## Non-Goals

- No bundled approval UI.
- No persistent or remembered approval store.
- No host selection, browser extension API, editor API, or notification system.
- No raw MCP payload handoff to the hook.

## Review Blockers

- `ApprovalRequest` includes raw JSON-RPC, raw MCP params, prompt text, environment values, or raw
  secret-bearing argument values.
- Approval hook rejection reasons are forwarded or audited verbatim.
- Approval-required calls can be forwarded after timeout, rejection, hook error, or missing hook.
- Documentation describes a bundled approval UI or persistent approval store as implemented.
