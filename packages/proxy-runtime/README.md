# @0disoft/mcp-security-proxy-runtime

Stdio session gating and subprocess bridge support for MCP Security Proxy.

```sh
npm install @0disoft/mcp-security-proxy-runtime
```

The runtime controls the MCP protocol boundary. Process isolation and operating-system sandboxing
remain the embedding host's responsibility.

Embedding hosts can run `runApprovalHookConformance` against their real hook wired to synthetic
approve, reject, error, abort, and concurrent test controls. Approval requests expose immutable
normalized facts, an opaque `approvalId`, the policy profile, and an `AbortSignal`; they never expose
the raw JSON-RPC id or raw MCP envelope. A passing conformance report proves hook mechanics only,
not a host UI or persistence policy.

See the [runtime flow documentation](https://github.com/0disoft/mcp-security-proxy/blob/main/docs/architecture/02-runtime-flow.md).
