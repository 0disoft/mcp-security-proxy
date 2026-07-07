# Secrets

Status: Draft

## Owners

- Primary owner: 0disoft
- Backup owner: 0disoft for repository leak response; secret owners for provider-side rotation
- Escalation path: SECURITY.md

## Secret Rules

- Do not commit credentials, real API tokens, real environment values, private keys, cookies, npm
  tokens, GitHub tokens, signing keys, or real user audit logs.
- Do not store raw environment values, prompt contents, or full sensitive tool arguments in audit
  events.
- Upstream server environment passthrough must be allowlist-based.
- Shell completion, JSON output, audit output, and error messages must not print secret values.
- Redaction tests must use fake values and must prove the fake value does not survive into audit
  snapshots.
- Public examples must use placeholders that cannot be mistaken for real credentials.

## Leak Response

1. Stop publishing or distributing the affected artifact.
2. Remove the secret from tracked files or generated artifacts.
3. Rotate the secret in its source system.
4. Add or update a regression check that would have caught the leak.
5. Record the fix without publishing sensitive exploit details.

## Validation

- Required validation names: docs, secret-scan, artifact-safety, repository-hygiene, smoke, check
  when commands exist.
- Release blocker status: any tracked secret or raw audit leak blocks release.
- Remaining operational risk: secret scanning covers tracked text files and common token shapes; it
  is not a replacement for provider-side token revocation or full artifact scanning.
