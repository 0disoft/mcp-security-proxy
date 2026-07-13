# Security Baseline

Status: Draft

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related checklist: .agents/checklists/security.md

## Baseline Rules

- Treat upstream MCP servers as untrusted.
- Treat MCP tool descriptors and schemas as hints, not proof of safety.
- Deny unsupported MCP methods by default.
- Deny unknown or ambiguous capabilities by default.
- Deny broad shell strings by default.
- Treat network rules as argument-level intent checks, not socket enforcement.
- Redact before audit writes, JSON output, completion output, and error details.
- Never store raw environment values, tokens, prompts, or full sensitive tool arguments in audit
  events.
- Default audit write failure to fail-closed unless policy explicitly chooses warn-and-continue.
- Keep public fixtures synthetic and covered by `pnpm run artifact-safety`.

## Matcher Requirements

- Path matching is lexical argument policy. Its contract must state that realpath, missing
  write-target, symlink, junction, mount, case-folding, and TOCTOU behavior are not enforced.
- Command matching must prefer executable plus argv arrays.
- Network matching must document which argument fields were inspected and which fields were not.
- Redaction must report replacement counts without returning the original values.

## Review Blockers

- A change claims OS sandboxing, malware scanning, secret-vault behavior, or socket enforcement.
- A change passes unsupported methods through without policy.
- A change logs raw secrets, raw environment values, raw prompts, or raw tool arguments.
- A change publishes real logs, private captures, generated output, or exploit corpus data.
- A change broadens path, shell, network, or token access without tests and migration notes.
- A change weakens validation or hides skipped checks.
