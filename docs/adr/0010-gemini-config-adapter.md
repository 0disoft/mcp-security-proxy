# Gemini CLI Configuration Adapter

Status: Accepted
Owner: 0disoft

## Context

Gemini CLI officially supports project-scoped local stdio MCP registration through `gemini mcp
add`. Project scope writes `.gemini/settings.json` in the selected working directory. Directly
editing that file would make this project responsible for merge behavior and future Gemini schema
changes.

Official contract: https://geminicli.com/docs/tools/mcp-server/

## Decision

`config-snippet --target gemini-cli-json` emits a read-only command descriptor for `gemini mcp add
--scope project --transport stdio`. It requires `--name`, preserves the complete proxy command and
argv, and never executes Gemini or writes settings during generation. `--gemini-command` selects
the executable recorded in the descriptor and defaults to `gemini`.

Gemini's CLI parser consumes the first `--` that separates its own options from nested command
arguments. The descriptor therefore emits two consecutive separators at the proxy's upstream
boundary. The pinned fixture proves that Gemini consumes one and stores the other in the proxy argv.

Gemini server names may not contain underscores because Gemini's policy parser uses underscores to
split MCP fully qualified tool names. The adapter retains the common 1..64 ASCII name bound and
adds this host-specific restriction.

## Security Boundary

- Generation is read-only and rejects control characters in every generated value.
- Project scope is explicit; user scope and `--trust` are never emitted.
- Policy contents, environment values, credentials, prompts, audit events, and existing Gemini
  settings are not read or emitted.
- Upstream argv is reproduced verbatim and may be sensitive; credentials must not be passed there.
- Running the generated descriptor is a separate action that changes `.gemini/settings.json` in
  the command's working directory.

## Compatibility Evidence

The harness pins Apache-2.0 `@google/gemini-cli@0.50.0`, installs it with registry credentials
cleared, sets an isolated home, executes the descriptor in a temporary project, and compares the
generated `.gemini/settings.json` command and argv. All temporary state is deleted after the run.

This proves project-scoped configuration acceptance only. It does not prove arbitrary Gemini CLI
versions, model authentication, live tool execution, workspace trust, or host approval UX.

## Consequences

- Gemini owns JSON serialization and merge behavior through its official CLI.
- The external compatibility aggregate requires public npm access to the pinned Gemini package.
- Updating the pinned version requires official-contract review and fixture regeneration.

## Review Blockers

- The generator writes `.gemini/settings.json` directly.
- The descriptor enables `--trust`, user scope, or environment injection by default.
- A fixture reads a real user home, authentication state, or registry credentials.
- Documentation calls configuration acceptance full Gemini runtime compatibility.
