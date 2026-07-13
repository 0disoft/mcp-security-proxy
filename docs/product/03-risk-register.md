# Risk Register

Status: Draft
Owner: 0disoft

## Purpose

Track product and security risks that can make MCP Security Proxy misleading or unsafe.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Proxy is mistaken for an OS sandbox | Users over-trust protection and run dangerous servers | State protocol-boundary scope in README, AGENTS, docs, and CLI help |
| Tool schema misclassification | Dangerous tool is shown or allowed as low risk | Keep deny-by-default behavior and require explicit policy for risky capabilities |
| Path policy overclaim | A lexical allow is mistaken for proof of the file opened by the upstream server | Name the mode lexical, reject ambiguous strings, keep symlink/junction/mount/TOCTOU outside the claim, and require a separate host-attestation contract for stronger evidence |
| Shell allowlist too broad | Arbitrary commands slip through a convenience pattern | Prefer exact commands or narrow argv patterns; document shell expansion behavior |
| Unsupported MCP method pass-through | Resources, prompts, sampling, roots, elicitation, or future methods bypass tool policy | Keep a method allowlist and deny unsupported methods by default |
| Upstream startup side effect | Server reads files or opens network before any MCP tool call | State the proxy only controls the MCP protocol boundary and treat upstream servers as untrusted |
| Network policy overclaim | Users believe the proxy blocks sockets directly | Document network rules as argument-level intent policy only |
| Audit log leaks secrets | Security tool becomes a data leak | Redact before write, never store raw env values, and test redaction fixtures |
| Audit failure fails open | Decisions proceed without usable evidence | Default audit failures to fail-closed unless policy explicitly selects warn-and-continue |
| Approval fatigue | Users approve everything | Keep approval as an optional hook and make policies explainable enough to avoid constant prompts |
| Compatibility drift | MCP client/server transport behavior changes | Keep protocol fixtures and pin tested MCP spec versions |
| SDK drift leaks into core | Core policy semantics change with adapter or SDK upgrades | Keep core evaluator independent from SDK and IO dependencies |

## Review Blockers

- The change removes or softens a mitigation without replacing it.
- The change expands allowed capability classes without testable policy rules.
- The change adds audit fields that may contain raw secrets.
- The change treats unsupported methods, network sockets, or server startup behavior as protected
  without documenting the boundary.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
