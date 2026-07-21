# Gemini Host Approval Policy Evidence

Status: Accepted
Owner: 0disoft
Source snapshot: 2026-07-21

## Context

The runtime `ApprovalHook` is an embedding API. Gemini CLI launches the proxy as an external MCP
server and does not inject that callback. Treating Gemini's own confirmation prompt as if it
resolved a proxy `approval_required` decision would create a false security claim: the proxy cannot
observe or authenticate that host decision.

Gemini CLI `0.50.0` separately supports host-owned MCP policy rules. An extension rule can select an
MCP server by `mcpName`, return `ask_user` for interactive calls, and return `deny` for headless
calls. Gemini ignores extension-provided `allow` and yolo decisions, so the integration cannot use
its own extension tier to bypass confirmation.

Official contract snapshots:

- https://geminicli.com/docs/reference/policy-engine/
- https://geminicli.com/docs/extensions/reference/

## Decision

The pinned Gemini compatibility harness checks project-scoped registration with the exact
`@google/gemini-cli@0.50.0` host. It separately loads a repository-owned synthetic extension policy
through exact `@google/gemini-cli-core@0.50.0` code and evaluates matching interactive,
non-interactive, and unrelated-server calls. The policy requires `ask_user` for interactive calls
to `msp-fixture` and `deny` for non-interactive calls.

This is compatibility evidence for a host-owned approval layer. It is not an implementation of the
runtime `ApprovalHook`, does not change proxy policy decisions, and does not allow a proxy
`approval_required` call to proceed without a real embedding hook. Proxy allow and deny rules remain
the inner enforcement boundary.

## Security Boundary

- The fixture uses a synthetic server name without underscores so Gemini policy matching cannot
  split the server identity ambiguously.
- The extension contains no `allow`, yolo, trust, credential, environment, command, or raw argument
  configuration.
- Interactive host calls require `ask_user`; headless calls fail closed with `deny`.
- User and administrator Gemini policies remain host-owned higher-precedence inputs. The proxy does
  not interpret them as policy evidence.
- The CLI registration fixture uses an isolated home and project and deletes them after each run.
- Policy loading and evaluation execute from the exact published core dependency in the same temporary install.

## Compatibility and Release Boundary

The fixture proves that the pinned host accepts and loads the registration and approval policy. It
does not prove an authenticated model session, terminal rendering, screen-reader behavior, keyboard
focus, prompt truncation, persistence choices, or other Gemini versions. Full Gemini approval UX
support therefore remains excluded from release claims until live host-specific evidence covers
those surfaces.

## Consequences

- Gemini users can add a defense-in-depth host confirmation layer without weakening proxy policy.
- The repository maintains one pinned extension-policy fixture and its exact loader/evaluator acceptance check.
- The CLI does not generate, install, or mutate Gemini policy files for users.
- A future in-band MCP elicitation bridge requires its own ADR and protocol fixtures.

## Review Blockers

- Documentation calls the host policy a proxy `ApprovalHook` bridge.
- The extension adds an `allow`, yolo, or trust bypass.
- Headless execution can reach the proxy after an `ask_user` decision without an interactive user.
- Fixture evidence reads a real Gemini home, authentication state, or user policy.
