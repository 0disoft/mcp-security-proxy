# Agent Plugins proof of concept

Status: repository-local compatibility proof, not a distributable runtime package.

This directory demonstrates the minimal `plugin.json` plus `mcp.json` packaging shape described by
the Agent Plugins 1.0.0 snapshot supplied on 2026-08-08. It does not replace the product, policy,
CLI, or release sources of truth elsewhere in this repository.

The MCP entry is intentionally deny-by-default and contains no environment block or secret value.
It must be launched with the repository root as the working directory after the normal build. Its
relative executable, policy, audit, and fixture-server paths are unsuitable for marketplace or
standalone distribution. A distributable plugin needs a separate decision for packaged policy
assets, absolute runtime resolution, user-owned audit paths, upstream server selection, and a live
refresh against the official Agent Plugins schema.

Compatibility evidence and remaining limitations are recorded in
`docs/ops/agent-plugin-compatibility-evidence.md`.
