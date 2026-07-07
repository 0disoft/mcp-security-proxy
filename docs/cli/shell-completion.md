# Shell Completion

Status: Draft
Repository Type: cli-tool

## Repository Type Contract

This repository type owns command behavior, arguments, flags, config loading, exit codes, terminal output, JSON output, runtime compatibility, and shell integration contracts.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Required Decisions

- Command list and flag ownership: docs/cli/command-contract.md
- Exit-code taxonomy: docs/cli/output-and-exit-codes.md
- Machine-readable output contract: completion output must not expose policy contents, captured
  tool arguments, environment values, or audit payloads.
- Config precedence and default behavior: docs/cli/configuration.md
- Runtime compatibility floor: Node.js `>=24.0.0` for the current private CLI package.

## Completion Scope

Shell completion may cover:

- stable command names documented in docs/cli/command-contract.md
- stable flags documented in command-specific help
- local policy file path completion
- server profile names when they can be read without exposing policy secrets
- output format values such as human or JSON modes

Shell completion must not cover:

- secret values
- environment variable values
- raw MCP tool arguments
- captured prompt contents
- audit log event payloads
- upstream server command arguments unless they are explicitly owned by this CLI

## Security Rules

- Completion scripts must be deterministic and safe to source in a shell startup file.
- Dynamic completion must fail closed when a policy file cannot be parsed.
- Dynamic completion must return profile or option names only, not full policy rule bodies.
- Completion errors must not print raw policy snippets, secret-like values, or MCP payloads.
- Generated completion output must match the implemented command contract before release.

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
- Completion suggests a command, flag, profile, or output mode that the CLI does not accept.
- Completion exposes policy internals, environment values, or captured MCP data.
