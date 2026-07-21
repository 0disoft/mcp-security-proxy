# Gemini CLI Configuration Compatibility Evidence

Status: Draft

## Scope

This evidence covers read-only generation, isolated project-scoped registration, and exact-package
loading and evaluation of one synthetic approval-policy extension with `@google/gemini-cli@0.50.0`
and `@google/gemini-cli-core@0.50.0`. It does not cover
authentication, live model-driven tool use, rendered approval UX, workspace trust, remote
transports, or other Gemini CLI versions.

## Recorded Evidence

- Decision: docs/adr/0010-gemini-config-adapter.md
- Approval policy decision: docs/adr/0014-gemini-host-approval-policy.md
- Generator fixture: fixtures/compatibility/cli-config-snippet.gemini-cli-json.json
- Approval extension: fixtures/compatibility/gemini-approval-policy/
- Host result: fixtures/compatibility/gemini-cli-config.summary.json
- Harness: scripts/check-gemini-config-fixture.mjs
- Validation: `node scripts/check-gemini-config-fixture.mjs`

The harness installs the exact public Apache-2.0 Gemini CLI package into a temporary directory with
empty npm configuration files and registry credential variables cleared. It uses a temporary home
and project, runs the generated descriptor, verifies `.gemini/settings.json`, loads the synthetic
policy with the exact published core policy loader, evaluates interactive, non-interactive, and
unrelated-server calls, normalizes temporary paths, and deletes all temporary state.

## Proven Contract

- Gemini accepts the generated server name and project-scoped stdio registration.
- The proxy executable and every nested argument are preserved exactly.
- Gemini consumes one parser separator while retaining the proxy's upstream separator.
- Gemini's exact core package loads a policy scoped to the exact `msp-fixture` MCP server name.
- Interactive calls receive the host decision `ask_user`; non-interactive calls receive `deny`.
- Calls attributed to another MCP server do not match the extension policy and fail closed in the fixture.
- The policy contains no `allow`, yolo, or trust bypass.
- No real home, authentication state, user policy, environment values, or audit logs are read.

## Remaining Risk

Gemini CLI configuration behavior can change after the pinned version and the external aggregate
requires public npm availability. Host policy acceptance does not bridge the proxy runtime
`ApprovalHook` and does not prove that an authenticated session renders a safe, accessible approval
prompt. User or administrator host policies also remain higher-precedence Gemini-owned inputs.
