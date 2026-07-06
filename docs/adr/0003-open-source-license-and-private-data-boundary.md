# Open Source License and Private Data Boundary

Status: Accepted
Owner: 0disoft

## Decision

MCP Security Proxy is published under the Apache License 2.0.

The public repository may contain source code, schemas, documentation, synthetic fixtures,
deny-by-default examples, and high-level security design notes. It must not contain real audit logs,
real organization policies, real MCP captures, private credentials, embargoed vulnerability details,
or exploit corpus data.

## Context

The project is intended to be embedded by local developer tools, MCP hosts, and internal agent
runners. A permissive license with an explicit patent grant is a better fit for security tooling
than an ambiguous public repository without a license.

Security review also depends on public contracts being inspectable. Hiding the policy engine does
not protect users. The sensitive boundary is data, private bypass details, and real operational
evidence.

## Consequences

- Root `LICENSE` uses Apache-2.0.
- Security reporting expectations live in `SECURITY.md`.
- Dependency policy must reject license drift that conflicts with Apache-2.0 distribution.
- Fixtures must be synthetic and safe to publish.
- Private exploit or real-log material belongs outside this public repository.

