# Output and Exit Codes

Status: Draft
Repository Type: cli-tool

## Repository Type Contract

This repository type owns command behavior, arguments, flags, config loading, exit codes, terminal output, JSON output, runtime compatibility, and shell integration contracts.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Output Principles

- Human output should explain what policy did and what the user can change.
- JSON output should be stable, redacted, and safe to pipe into tests or host integrations.
- Audit output should be JSON Lines and should not duplicate full raw tool arguments.
- Denial messages should name the rule, capability, and high-level reason without exposing secrets.
- A policy deny decision is a valid policy result, not a CLI crash.

## Provisional Exit Codes

| Code | Meaning |
| ---: | --- |
| 0 | Command completed successfully, including dry-run commands that return an allow or deny decision |
| 1 | Handled runtime failure outside normal policy decision flow |
| 2 | CLI usage error |
| 3 | Policy file parse or validation error |
| 4 | Upstream MCP server startup or protocol error |
| 5 | Audit output failure |
| 6 | Unsupported method or protocol feature when invoked as a standalone CLI evaluation |
| 7 | Internal proxy error |

## JSON Result Shape

The exact schema is not final, but JSON command output should follow this shape:

```json
{
  "ok": true,
  "command": "eval-call",
  "profile": "local-files",
  "decision": {
    "action": "deny",
    "reason": "path denied by policy",
    "ruleId": "deny-home-secrets",
    "capabilities": ["file-read"]
  },
  "redaction": {
    "applied": true,
    "counts": {
      "secret": 1
    }
  }
}
```

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
