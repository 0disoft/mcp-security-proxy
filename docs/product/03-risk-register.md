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
| Path matcher bypass | File policy can be escaped through normalization or symlink edge cases | Normalize paths, reject ambiguous paths, and add fixture tests before implementation |
| Shell allowlist too broad | Arbitrary commands slip through a convenience pattern | Prefer exact commands or narrow argv patterns; document shell expansion behavior |
| Audit log leaks secrets | Security tool becomes a data leak | Redact before write, never store raw env values, and test redaction fixtures |
| Approval fatigue | Users approve everything | Keep approval as an optional hook and make policies explainable enough to avoid constant prompts |
| Compatibility drift | MCP client/server transport behavior changes | Keep protocol fixtures and pin tested MCP spec versions |

## Review Blockers

- The change removes or softens a mitigation without replacing it.
- The change expands allowed capability classes without testable policy rules.
- The change adds audit fields that may contain raw secrets.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
