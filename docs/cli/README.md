# CLI Tool

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
- Machine-readable output contract: JSON output must be redacted and fixture-tested.
- Config precedence and default behavior: docs/cli/configuration.md
- Runtime compatibility floor: UNDECIDED.

## CLI Purpose

The CLI should make MCP policy review usable without writing host integration code first. It should
run a local stdio proxy, validate policies, inspect discovered tools, and dry-run tool calls.

## CLI Non-Goals

- Managing remote MCP servers
- Providing a hosted policy UI
- Acting as a shell sandbox
- Persisting secrets
- Replacing host approval UX

## Review Blockers

- A command changes without updating help, examples, output, and exit-code expectations.
- JSON output exposes generated or existing file contents.
- Runtime compatibility changes without smoke validation.
