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
| 4 | Upstream MCP server startup, protocol, or non-zero exit failure |
| 5 | Audit output failure |

## JSON Result Shape

The exact schema is not final, but JSON command output should follow this shape:

```json
{
  "ok": true,
  "command": "eval-call",
  "profile": "local-files",
  "decision": {
    "action": "deny",
    "evidence": [
      {
        "code": "policy.rule_deny",
        "ruleId": "deny-private-files",
        "capability": "file-read",
        "reason": "matched deny rule"
      }
    ]
  },
  "redaction": {
    "applied": true,
    "counts": {
      "secret": 1
    }
  }
}
```

## Config Snippet Shape

Successful `config-snippet --target stdio-json` output is the descriptor itself, without an `ok`
wrapper:

```json
{
  "command": "mcp-security-proxy",
  "args": [
    "run",
    "--policy",
    "./policy.json",
    "--profile",
    "local",
    "--",
    "node",
    "server.js"
  ]
}
```

The command and each argument are separate JSON strings; consumers must not join them into a shell
command. The output may contain user-supplied local paths, but it never contains policy file
contents, environment values, audit events, or upstream process output. Usage failures use exit
code 2, policy or profile failures use exit code 3, and errors go to stderr because no descriptor
was produced. User-supplied upstream arguments are reproduced exactly and may themselves be
sensitive; credentials must not be placed in argv or committed with generated host configuration.

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
