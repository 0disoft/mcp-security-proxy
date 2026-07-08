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
- secret label matchers
- audit destination and failure behavior

The default action must be deny. Unknown capabilities, unsupported MCP methods, ambiguous matcher
inputs, and missing approval hooks must resolve to deny unless a future ADR records a narrower
exception.
Secret-like argument keys are reduced to label-only facts, such as `token` or `api-key`, without
retaining the raw value. A call that contains a secret fact must declare the `secret` capability
and match an explicit secret label rule before any allow or approval-required rule can match.
Policy validation must reject ambiguous configuration before runtime use. This includes duplicate
profile ids, duplicate rule ids within a profile, duplicate method allowlist entries, empty
selector arrays, empty path/network matchers, unsupported rule method entries, invalid redaction
detectors, and audit destinations whose `path` setting contradicts the selected destination.

## Decision Order

Decision order is:

1. protocol method policy
2. explicit deny rules
3. approval-required rules
4. explicit allow rules
5. default deny

The evaluator must return rule evidence for the winning decision. Classifier output may explain why
a rule matched, but classifier output alone must not grant permission.
Decision evidence includes a stable machine-readable code and a human-readable reason. The reason
is for operators; the code is for tests, audit consumers, and future integrations.
Rule decisions must use action-specific codes (`policy.rule_allow`, `policy.rule_deny`, or
`policy.rule_approval_required`). Fail-closed checks that happen before rule evaluation must use
specific denial codes for ambiguous paths, free-form shell wrappers, ambiguous network targets,
missing secret capability, and unknown capabilities so consumers do not parse operator text.

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

The current MVP matcher canonicalizes argument-level path strings only. It normalizes separators,
removes `.` segments, lowercases Windows drive-letter prefixes, and then compares remaining path
segments case-sensitively. It rejects traversal, encoded separators, home-directory expansion, UNC
paths, NUL bytes, and non-NFC Unicode as ambiguous. It does not claim symlink or OS-level realpath
containment; that belongs to a future filesystem-aware resolver or sandbox boundary.

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
