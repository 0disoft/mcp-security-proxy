# Code Review Checklist

Status: Draft

## Contract

Code review blockers include ownership drift, hidden auth or tenant rules, untested failure paths, contract drift, fake validation success, and generated-output dependency.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Merge-blocking validation: VALIDATION.md
- Related checklist: CHECKLIST.md

## Checklist

- Method policy, tool discovery, tool call, redaction, and audit behavior remain synchronized.
- Denied calls and unsupported methods are not forwarded upstream.
- Core evaluator code does not depend on runtime IO, subprocess control, or SDK-specific objects.
- Path, command, and network matcher changes have fixtures.
- JSON output and audit output are redacted.
- Policy, audit, CLI, and public API changes include semver and migration review.
- New dependencies pass license and boundary review.

## Review Blockers

- A change moves policy decisions into CLI or runtime glue instead of the evaluator.
- A change logs raw sensitive values.
- A change updates behavior without updating contract docs and fixtures.
- A change weakens validation or hides skipped checks.
- A change lacks failure, recovery, security, performance, or test evidence where relevant.
