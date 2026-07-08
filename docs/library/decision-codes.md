# Decision Codes

Status: Draft
Repository Type: library

## Repository Type Contract

This repository type owns public API surface, package compatibility, semantic versioning,
migration guidance, distribution artifacts, and consumer-facing deprecation policy.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Public API decision: docs/library/public-api.md
- Schema asset: packages/contracts/schemas/decision.v1.schema.json
- TypeScript export: packages/contracts/src/decision.ts

## Consumer Contract

Decision evidence codes are stable machine-readable values for audit consumers, tests, and host
integrations. Consumers should route on `decision.evidence[].code` and treat `reason` as
human-readable operator text that may change before a public release.
Consumers should treat `reason` as human-readable operator text, not as a programmatic routing key.

Adding, removing, or changing a code changes the public decision contract. Before public release,
the source-of-truth docs, JSON schema, package exports, compatibility fixtures, and migration notes
must move together. After public release, semantic versioning and migration guidance apply.

## Code Catalog

| Code | Meaning |
| --- | --- |
| `jsonrpc.invalid` | A JSON-RPC message was malformed or violated the local boundary shape. |
| `jsonrpc.frame_too_large` | A newline-delimited JSON-RPC frame exceeded the configured byte limit. |
| `jsonrpc.too_deep` | A parsed JSON-RPC message exceeded the configured JSON depth limit. |
| `jsonrpc.unmatched_response` | A response id did not match a pending request for the same direction. |
| `jsonrpc.request_extra_fields_redacted` | Unknown JSON-RPC request envelope fields were removed before forwarding. |
| `jsonrpc.response_extra_fields_redacted` | Unknown JSON-RPC response envelope fields were removed before forwarding. |
| `jsonrpc.upstream_error_data_redacted` | Upstream JSON-RPC `error.data` was removed before forwarding. |
| `jsonrpc.upstream_error_message_redacted` | A sensitive-looking upstream JSON-RPC error message was replaced. |
| `jsonrpc.upstream_error_redacted` | Non-standard upstream JSON-RPC error fields were removed before forwarding. |
| `method.supported` | The method is in the current supported MCP method set. |
| `method.unsupported` | The method is outside the current supported MCP method set and was denied. |
| `method.server_origin_disallowed` | A server-origin request or notification is not allowed by the current boundary. |
| `method.server_origin_ping_params` | A server-origin `ping` carried params and was denied. |
| `tool.not_visible` | A tool call referenced a tool not visible in the latest sanitized discovery state. |
| `discovery.filtered` | Tool discovery was filtered or sanitized before forwarding. |
| `policy.profile_not_found` | The selected policy profile was missing. |
| `policy.default_deny` | No explicit allow or approval-required rule matched, so default deny applied. |
| `policy.rule_allow` | An explicit allow rule matched. |
| `policy.rule_deny` | An explicit deny rule matched. |
| `policy.rule_approval_required` | An explicit approval-required rule matched. |
| `policy.ambiguous_path` | A path fact was ambiguous and failed closed before rule evaluation. |
| `policy.free_form_shell` | A free-form shell wrapper was detected and failed closed before rule evaluation. |
| `policy.ambiguous_network` | A network fact was ambiguous and failed closed before rule evaluation. |
| `policy.secret_capability_required` | A secret-like argument fact appeared without explicit secret capability. |
| `policy.unknown_capability` | An unknown capability was denied before rule evaluation. |
| `policy.approval_denied` | A host approval hook rejected an approval-required call. |
| `policy.approval_hook_failed` | A host approval hook errored or timed out and the call failed closed. |
| `policy.approval_hook_missing` | No approval hook was available for an approval-required call. |
| `runtime.upstream_exit` | The upstream process exited non-zero or terminated unexpectedly. |
| `runtime.upstream_stderr` | Upstream stderr was summarized without storing raw stderr lines. |

## Review Blockers

- A code appears in `DECISION_REASON_CODES` but is missing from this catalog.
- A code appears in this catalog but is missing from `DECISION_REASON_CODES`.
- Decision fixtures include `reason` without `code`.
- Audit or compatibility docs tell consumers to parse `reason` for routing.
