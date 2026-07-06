# Security Policy

Status: Draft

## Supported Versions

No implementation release exists yet. Security reports are still welcome for repository documents,
examples, future package skeletons, and any security claims that could mislead users.

## Reporting a Vulnerability

Report vulnerabilities privately when they involve:

- bypasses of documented policy behavior
- raw secret, environment, prompt, path, or tool-argument exposure
- unsafe examples that encourage overbroad file, shell, network, or token access
- denial behavior that can be mistaken for OS sandboxing
- dependency, release, or package-distribution risks

Use the repository security advisory flow when available. If that flow is unavailable, contact the
maintainer through a private channel before publishing exploit details.

## Public and Private Boundary

Public repository content may include source code, schemas, documentation, synthetic fixtures,
deny-by-default examples, and high-level threat-model notes.

Do not publish real user audit logs, real company policy files, real MCP server captures, private
credentials, reporter identities, embargoed bypass details, or exploit corpus data.

## Response Expectations

- Acknowledge actionable reports when maintainer availability allows.
- Keep exploit details private until a fix, mitigation, or disclosure decision exists.
- Add regression fixtures for confirmed bypasses using synthetic data only.
- Update documentation when a security boundary or limitation was unclear.

