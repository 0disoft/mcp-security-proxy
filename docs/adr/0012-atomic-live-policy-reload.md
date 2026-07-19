# Atomic Live Policy Reload

Status: Accepted
Owner: 0disoft

## Purpose

Allow a long-running local stdio proxy to adopt a validated policy replacement without exposing a
partially read document, silently changing its audit sink, or letting a pending approval complete
under stale authority.

## Source of Truth

- Policy model: docs/architecture/04-policy-model.md
- Runtime flow: docs/architecture/02-runtime-flow.md
- CLI contract: docs/cli/command-contract.md
- Operations contract: docs/ops/config-and-env.md

## Decision

CLI live reload is opt-in through `run --watch-policy`. The CLI watches the configured policy
file's parent directory, filters notifications to the target filename, debounces them for 100 ms,
and rereads the complete file. Watching the directory supports common save-by-rename behavior and
does not hold the policy file open.

A candidate must pass JSON parsing, complete policy validation, active-profile validation, and an
audit-contract comparison before it reaches the runtime. The active profile's audit destination,
path, failure action, and capture flags are immutable for a live run because the audit writer is
assembled at startup and is not part of the policy swap.

`ProxySession.preparePolicyReplacement` validates again, creates a deeply frozen snapshot, aborts
pending approval hooks, and returns a one-shot commit. The stdio bridge orders that commit after any
in-flight audit-before-forward write; the commit increments a session-local revision, replaces the
active reference, and clears remembered tool visibility. `replacePolicy` is the immediate
prepare-and-commit convenience API. Aborted calls fail closed with `policy.reloaded`. Calls already
forwarded upstream cannot be retroactively canceled by this protocol-boundary proxy.

Read, parse, profile, audit, watcher, or runtime-validation failure retains the previous policy.
Ops events expose only stable rejection codes and bounded counters; they do not include policy
text, parser exceptions, or local paths.

## Alternatives Rejected

- Mutating policy fields in place: concurrent message handling could observe a mixed old/new
  document and cached discovery derived from another revision.
- Watching the policy file handle directly: editor atomic-save patterns replace the file and can
  detach a file watcher from the active pathname.
- Reloading the audit writer in the same step: swapping append destinations and failure semantics
  needs its own flush, ownership, and rollback design.
- Automatically reloading on every run: operators need an explicit stability choice and embedders
  may own configuration through another source.
- Canceling already-forwarded calls: the stdio boundary has no general operation-revocation
  contract with arbitrary MCP servers.

## Consequences

- A valid replacement requires fresh tool discovery before direct calls can use remembered tools.
- Pending approval UI or background work must honor the supplied abort signal.
- Filesystem notifications are best-effort. Operators needing distributed or network-filesystem
  consistency still need an external configuration system and process restart strategy.
- The `msp.policy.v1` document shape and startup behavior without `--watch-policy` are unchanged.

## Rollback

Omit `--watch-policy` and restart the process with the last known-good policy. Removing the additive
runtime source and replacement APIs requires the corresponding prerelease API and migration review;
it does not require a policy file migration.

## Review Blockers

- A candidate becomes visible before full validation completes.
- Reload changes the active audit contract without an atomic writer handoff design.
- Discovery state or pending approvals survive an accepted replacement.
- Rejection removes the previous policy or leaks raw policy content, parser details, or local paths.
- Documentation claims already-forwarded work is canceled or that filesystem watching provides
  distributed consistency.
