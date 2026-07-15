# Runtime MCP SDK Boundary

Status: Accepted
Owner: 0disoft

## Context

MCP Security Proxy sits on a hostile protocol boundary. It must reject malformed envelopes,
preserve JSON-RPC id value and type, correlate requests in both directions, sanitize unknown
fields, and apply policy before forwarding. Delegating those responsibilities to a general MCP SDK
can normalize or reject input before the proxy records the boundary decision, and SDK transport
lifecycles can couple policy behavior to a dependency upgrade.

The current stdio runtime already implements the required bounded framing, envelope validation,
direction policy, request correlation, discovery filtering, call evaluation, redaction, audit, and
process lifecycle behavior. External JavaScript and Python SDK clients remain useful as independent
compatibility witnesses, but that is a different responsibility from product runtime ownership.

## Decision

The published `contracts`, `core`, `mcp-adapter`, `proxy-runtime`, and `cli` packages, plus private
`testkit`, must not declare an MCP SDK in dependencies, devDependencies, peerDependencies, or
optionalDependencies.

The product owns its strict JSON-RPC and stdio boundary directly:

- `contracts` owns transport-neutral policy, decision, audit, and operations data contracts;
- `core` owns policy semantics and remains independent from SDK and runtime IO;
- `mcp-adapter` owns the narrow validated JSON-RPC envelope model and MCP method normalization;
- `proxy-runtime` owns bounded framing, correlation, sanitization, policy gating, and stdio
  lifecycle behavior;
- `cli` composes the runtime without exposing an SDK client or server API.

Pinned MCP SDKs may be installed only in isolated temporary external-compatibility environments.
They must not enter workspace manifests, published tarballs, product runtime imports, or public API
claims. Their evidence stays limited to the exact client, server, version, and scenarios recorded
by the compatibility registry.

A future SDK-backed integration requires a new ADR. The default shape is a separate optional
adapter package or entrypoint with an explicit dependency and release scope; it must not replace or
weaken the strict boundary owned by the current runtime. That ADR must explain the interoperability
gap, input-normalization order, failure semantics, dependency and license review, public API impact,
fixture evidence, and rollback path.

## Consequences

- MCP SDK upgrades cannot silently change core policy or stdio boundary behavior.
- The project carries maintenance responsibility for its narrow JSON-RPC and stdio implementation.
- MCP specification changes must be adopted deliberately through contracts and compatibility
  fixtures rather than inherited from an SDK update.
- External SDK fixtures remain valuable independent implementations, not product dependencies.
- HTTP transport may still use a dedicated transport dependency after its own ADR, but it cannot
  bypass the validation, policy, correlation, redaction, or audit invariants defined here.

## Enforcement

- `pnpm run package-surface` rejects MCP SDK package names in every workspace dependency group.
- Product package tarball and consumer checks prove that SDK code is absent from published
  artifacts.
- External compatibility scripts install pinned SDKs only under ignored temporary directories and
  must keep registry credentials and raw transcripts out of tracked evidence.
- Release records keep `mcpSdkDependency.status` excluded while this ADR remains active. Inclusion
  requires a superseding ADR and separate implementation evidence.

## Review Blockers

- A workspace manifest declares an MCP SDK in any dependency group.
- Product source imports an MCP SDK without a superseding ADR and isolated package boundary.
- Compatibility fixtures are described as product runtime dependencies or broad SDK support.
- An SDK or transport helper parses or normalizes an envelope before the proxy's strict boundary
  validation can apply.
- A future adapter changes policy, redaction, correlation, or audit behavior to match SDK defaults.
