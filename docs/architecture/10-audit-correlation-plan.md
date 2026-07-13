# Audit Correlation Plan

Status: Implemented

## Purpose

Define the v2 audit correlation metadata needed to connect protocol boundary events without
storing raw MCP payloads, raw prompt text, raw tool arguments, environment values, credentials, or
full unredacted paths.

Audit correlation v2 is implemented as an optional `correlation` object on
`msp.audit-event.v1`. Existing consumers may ignore the optional object; consumers that opt in use
`correlationVersion: msp.audit-correlation.v2` as the nested contract discriminator.

## Scope

The current audit event contract records redacted decisions and redaction summaries. The v2
correlation work should add enough metadata for local operators and host integrations to answer:

- which request, response, denial, redaction, discovery update, approval decision, or transport
  failure belongs to the same protocol flow;
- whether a response matched a pending request by exact JSON-RPC id value and type;
- which sanitized discovery generation made a later tool call visible or not visible;
- how long a boundary operation took without storing raw payloads.

This plan does not approve a hosted control plane, SIEM integration, raw log upload path, or
cross-machine identity graph.

## Metadata

Each audit event that is tied to a protocol frame can carry an optional correlation
object with these fields:

- `correlationVersion`: fixed string for the new correlation contract.
- `sessionId`: random per-process identifier, not derived from user, machine, policy path, or
  upstream command.
- `sequence`: monotonically increasing integer within the proxy session.
- `direction`: `client_to_upstream`, `upstream_to_client`, `server_origin`, or `runtime`.
- `transport`: `stdio` for the implemented runtime path.
- `transportEventId`: local per-transport event identifier.
- `jsonRpcIdHash`: keyed hash of the JSON-RPC id when an id exists.
- `jsonRpcIdType`: `string`, `number`, `null`, or `absent`.
- `method`: method name when the frame is a request or notification.
- `matchedRequestMethod`: original request method when a response matches pending state.
- `discoveryGeneration`: monotonically increasing number after each accepted sanitized
  `tools/list` response.
- `pendingAgeMs`: bounded elapsed time between request receipt and matched response or timeout.
- `durationMs`: bounded elapsed time for policy evaluation, approval hook wait, or write failure
  handling when available.

## Privacy Rules

- Do not store raw JSON-RPC ids; use `jsonRpcIdHash` with a per-session random salt.
- Do not store raw params, tool arguments, prompt text, environment values, credentials, cookies,
  private keys, or upstream stderr lines.
- Do not store full unredacted filesystem paths or URLs in correlation metadata.
- Do not derive `sessionId` from username, hostname, cwd, policy path, upstream executable, or
  stable machine identifiers.
- Do not make correlation metadata required for policy enforcement. Missing correlation metadata
  must not turn a denied action into an allow.

## Runtime Flow Requirements

- Request receipt assigns `sequence` and `transportEventId` before policy evaluation.
- Pending request state stores correlation metadata alongside method and expiry, still bounded by
  max in-flight count and TTL.
- Response handling copies matched request correlation fields only after exact JSON-RPC id value and
  type match.
- Unmatched responses receive their own correlation metadata and must not guess a request link.
- Discovery filtering increments `discoveryGeneration` only after an accepted `tools/list` response
  has been sanitized and visible tool state has been replaced.
- Tool-call audit events include the current `discoveryGeneration` so `tool.not_visible` decisions
  can be explained without storing raw descriptors.
- Approval hook audit events include duration and timeout state, not raw host rejection reasons.

## Compatibility and Migration

Runtime audit correlation fixture evidence covers matched response routing, keyed ID hashing, and
raw-ID absence.

Audit correlation v2 requires a schema change, new compatibility fixtures, and migration notes.
Before implementation lands:

- add the correlation object to the audit event schema as optional;
- document which fields are stable routing keys;
- add JSONL fixtures for matched response, unmatched response, discovery replacement, approval
  timeout, and upstream failure;
- update migration guidance to say v1 consumers must ignore unknown audit fields until they opt in
  to v2 correlation;
- keep `decision.evidence[].code` as the routing source for policy outcomes.

## Implemented Decisions

- `sessionId` resets for each `ProxySession`. A future supervisor creates a new session and salt
  for each upstream restart.
- `jsonRpcIdHash` is HMAC-SHA-256 with a random, non-exported per-session key.
- Host-supplied correlation identifiers are not accepted by the current API.
- `sessionId`, `transportEventId`, and `jsonRpcIdHash` are stable routing keys only within one
  session. `sequence` orders audit events within that session.
