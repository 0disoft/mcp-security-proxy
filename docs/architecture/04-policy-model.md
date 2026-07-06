# Policy Model

Status: Draft

## Purpose

Define the policy vocabulary that MCP Security Proxy uses before implementation language, package
format, or MCP SDK choices are final.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Policy Shape

A policy contains:

- schema version
- default action
- one or more server profiles
- method allowlist and unsupported-method behavior
- discovery rules for tool visibility
- call rules for allow, deny, or approval-required decisions
- path, command, network, and redaction matchers
- audit destination and failure behavior

The default action must be deny. Unknown capabilities, unsupported MCP methods, ambiguous matcher
inputs, and missing approval hooks must resolve to deny unless a future ADR records a narrower
exception.

## Decision Order

Decision order is:

1. protocol method policy
2. explicit deny rules
3. approval-required rules
4. explicit allow rules
5. default deny

The evaluator must return rule evidence for the winning decision. Classifier output may explain why
a rule matched, but classifier output alone must not grant permission.

## Path Matching

Path rules should be based on allowed and denied roots, not broad glob shortcuts.

Before a path decision, the implementation must define how it handles:

- absolute path normalization
- relative paths and home-directory expansion
- symbolic links and realpath resolution
- non-existent write targets by checking the parent directory
- Windows drive letters, UNC paths, and case-insensitive filesystems
- Unicode normalization differences
- traversal segments such as `..`

Ambiguous paths must fail closed.

## Command Matching

Command policy should match executable identity plus an argv array. Free-form shell strings are not
safe defaults.

The default policy posture must deny:

- `sh -c`
- `bash -c`
- `zsh -c`
- `powershell -Command`
- `pwsh -Command`
- `cmd /c`

Any future support for shell strings must require an explicit high-risk rule and dedicated tests.

## Network Matching

Network rules are argument-level intent policy. They inspect URL, hostname, domain, IP, or request
metadata that appears in MCP tool arguments. They do not block sockets opened directly by an
upstream server process outside the MCP message boundary.

Default-deny targets should include localhost, private IP ranges, link-local ranges, and cloud
metadata endpoints unless an explicit policy permits them.

## Audit Matching

Audit policy controls event destination, content limits, retention hints, and failure behavior.
Audit events must receive redacted summaries, not raw prompts, raw environment values, raw secrets,
or full sensitive tool arguments.

