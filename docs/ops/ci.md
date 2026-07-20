# CI

Status: Draft

## Operational Contract

Cover required checks, branch protection, pipeline stages, artifacts, failure policy, local parity, and stop conditions.

## Owners

- Primary owner: 0disoft
- Backup owner: 0disoft
- Escalation path: repository issues for non-sensitive failures; SECURITY.md for sensitive failures

## Local Check Contract

The current local CI equivalent is:

```powershell
pnpm run check
```

`pnpm run check` runs:

- deterministic Prettier checks for TypeScript, JavaScript automation, package manifests, root JSON
  configuration, and tracked GitHub workflows
- Oxlint correctness and suspicious-rule checks for TypeScript and JavaScript, including Node.js and
  Vitest-aware rules
- workspace TypeScript typecheck
- workspace tests
- contract checks for contracts and core
- documentation contract check
- schema contract checks
- migration-note checks
- package surface, tracked public API report drift, tracked-file secret scans, public artifact safety checks, repository hygiene
  checks, validation registry checks, CI contract checks, compatibility evidence checks, dependency
  license report checks, release-readiness and publication receipt checks, and performance smoke
  checks
- package tarball allowlist, offline npm installation, ESM import, declaration resolution, and
  installed CLI help checks for the five publishable candidates
- CLI smoke checks against the local fixture policy and the secret-label fixture policy

The offline aggregate intentionally does not run `registry-smoke`. Registry validation requires an
exact already-published version and public npm network access, so it cannot be release-approval
evidence for the artifact it verifies.

## Hosted Workflow

GitHub Actions runs `.github/workflows/ci.yml` on `main` pushes and pull requests. The workflow:

- checks out the repository
- installs Node.js 24.11.1
- installs Python 3.11.15 for the external Python MCP client fixture
- enables pnpm 11.7.0 through Corepack
- installs the locked dependency graph
- runs `pnpm run check`
- runs `git diff --check`
- runs `pnpm run process-tree-smoke` on Ubuntu and Windows in a focused matrix job

The external compatibility aggregate also installs exact `@openai/codex@0.144.4` into a temporary
directory with registry credentials cleared and verifies generated MCP registration under a
temporary `CODEX_HOME`. It never reads or writes the runner user's Codex configuration.

The aggregate also installs exact `@google/gemini-cli@0.50.0`, runs generated project-scoped MCP
registration under an isolated home and working directory, and verifies only the temporary
`.gemini/settings.json`. It does not authenticate or start a Gemini model session.

`pnpm run ci-contract` keeps this workflow aligned with the documented Node.js version, pnpm
version, Python compatibility version, read-only permissions, pinned actions, local check command,
diff hygiene command, and the cross-platform process-tree smoke matrix.
CI workflows must not publish packages, create releases, request write permissions, request
`id-token: write`, or reference registry publish tokens.

## Release Workflow

`.github/workflows/release.yml` is the only tracked workflow allowed to request `id-token: write`.
It runs only for version tags matching `vMAJOR.MINOR.PATCH[-PRERELEASE]`, uses the npm environment
for Trusted Publisher ownership, fetches full Git history so reachable historical approval commits
can be verified, runs `pnpm run check`, verifies `scripts/check-release-publish-plan.mjs`, and
pins Python 3.11.15 for the external compatibility matrix before publishing only the
release-recorded public packages with provenance. The publish job has only `contents: read` and
`id-token: write`; it must not use long-lived npm tokens. The workflow runs `pnpm run
registry-smoke` after all five publish steps; the script derives the exact version from the release
tag and retries bounded npm registry reads to tolerate short publication propagation delays.

Only after the publish job and its registry smoke succeed, the separate `github-release` job checks
out the tagged source and runs `scripts/create-github-release.mjs` with job-local `contents: write`.
The script refuses non-SemVer or missing tags, marks prerelease tags as prereleases, generates release
notes, and verifies an existing matching Release instead of creating a duplicate. A failed Release
API call can therefore be retried as a failed job without rerunning successful immutable npm publish
steps. The automatic `GITHUB_TOKEN` is command-runtime only and is never accepted as a script
argument or printed.

The release workflow requires npm Trusted Publisher ownership configured for the
`0disoft/mcp-security-proxy` repository, the package manifests are approved for public package
posture, and an approved release readiness record names the reachable target commit and exact
validation evidence.

Post-publication facts are stored separately from approval records. The release-readiness aggregate
validates each tracked publication receipt against its approved package set, release workflow run,
registry smoke run, integrity values, and provenance linkage without making network requests.
The separate read-only Publication Receipt workflow generates a reviewable JSON artifact after a
successful manually dispatched Registry Smoke; it never writes to the repository.

The first-package bootstrap path is not a GitHub Actions workflow. Its source of truth is
`docs/ops/npm-bootstrap.md`; it keeps credentials in an interactive npm owner session and produces
only ignored, checksummed staging artifacts. CI validates the blocked/approved/completed plan shape
offline, dry-runs the staged bootstrap tarballs on the hosted runner, and rejects any bootstrap token
path added to the normal release workflow.

## Registry Smoke Workflow

`.github/workflows/registry-smoke.yml` is a read-only, manually dispatched recovery and verification
workflow. It requires an exact published semver and the successful Release workflow run ID for that
version. Those inputs form a strict run name consumed by receipt automation; they do not grant write
access. The workflow installs all five packages from public npm with an empty temporary user config
and lifecycle scripts disabled, verifies sha512 integrity and npm SLSA provenance metadata, then
runs the shared ESM, TypeScript declaration, and CLI help consumer checks.
The same temporary consumer installs the exact pinned MCP SDK and filesystem server, starts the
registry-installed CLI as a real stdio proxy, completes initialize and discovery, proves one
in-scope read succeeds, proves an out-of-scope read is denied, and checks that audit output contains
decision codes without raw paths or arguments. The onboarding path uses no workspace `dist` output
or repository fixture policy. It neither accepts dist-tags or semver ranges nor reads npm
credentials.

## Publication Receipt Workflow

`.github/workflows/publication-receipt.yml` starts only from the completed Registry Smoke event and
runs its job only when that smoke concluded successfully. It checks out the default branch with
read-only Actions and contents permissions, then `scripts/generate-publication-receipt.mjs` parses
the structured smoke run name and verifies the completed Release and Registry Smoke runs through
GitHub's public Actions API. The generator resolves the version tag to its commit, loads the matching
approved release and completed bootstrap records, and reads public npm metadata for the exact
five-package set. It rejects package tag drift, a bootstrap tag that does not match the completed
plan, missing integrity, missing SLSA provenance, missing SHA-1 shasums, and publication timestamps
that do not precede the completed smoke.

The resulting `<version>.publication.json` is retained as a workflow artifact for 30 days. The
workflow has no contents write permission and does not open a pull request or commit evidence.
Owners review and commit the immutable receipt separately so generated network observations cannot
silently rewrite the repository's release history.

## Validation

- Required validation names: format, lint, typecheck, test, contract, docs, schema-contract, migration-check,
  package-surface, api-report, registry-smoke, secret-scan, artifact-safety, repository-hygiene,
  validation-registry, ci-contract, compatibility, license-report, release-readiness,
  performance-smoke, check.
- Release blocker status: public behavior changes are blocked when local `check` or hosted CI fails.
- Remaining operational risk: the focused matrix covers managed process-tree shutdown on Ubuntu
  and Windows and abrupt proxy termination through Windows Job Object kill-on-close. The aggregate
  unit contract separately proves that containment setup failure returns exit 4 before CLI/upstream
  execution. POSIX abrupt parent-death reclamation still requires an external supervisor. Registry
  smoke detects a bad publication only after immutable package versions exist, so recovery still
  uses the documented deprecation path.
