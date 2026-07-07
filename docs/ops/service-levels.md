# Service Levels

Status: Draft

## Operational Contract

This project does not currently promise hosted uptime or latency SLOs. Service levels are local
runtime expectations for a CLI/library that mediates stdio MCP traffic.

## Owners

- Primary owner: 0disoft
- Backup owner: 0disoft
- Escalation path: repository issues for non-sensitive reliability defects; SECURITY.md for
  reliability defects that expose sensitive data

## Current Expectations

- Policy validation should fail clearly on malformed or unsupported policy input.
- Live `run` should keep stdout reserved for MCP protocol frames.
- Unsupported MCP methods should fail closed instead of passing through.
- Upstream protocol, startup, and non-zero exit failures should map to the documented CLI exit
  behavior.
- Audit write failures should fail closed when audit output is required.
- Tool-call decisions should remain deterministic for the same policy, profile, and call envelope.

## Non-Goals

- Hosted uptime SLO.
- Multi-tenant availability SLO.
- Built-in health endpoint.
- Built-in metrics, traces, dashboards, or alerts.

## Validation

- Required validation names: docs, contract, test, smoke, check.
- Release blocker status: public release is blocked when documented exit behavior, protocol
  framing, or deny-by-default behavior lacks validation.
- Remaining operational risk: exact latency and throughput budgets remain deferred until broader
  compatibility fixtures exist.
