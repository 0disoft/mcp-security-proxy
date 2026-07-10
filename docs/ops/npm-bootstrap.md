# npm Package Bootstrap

Status: Blocked

## Purpose

The five `@0disoft/mcp-security-proxy-*` package names do not exist on npmjs.org yet. npm Trusted
Publisher configuration is package-owned, so each name needs one controlled bootstrap publication
before the normal OIDC release workflow can own later versions.

Bootstrap publication is package-name initialization, not a product release. It uses version
`0.0.0-bootstrap.0` and the `bootstrap` dist-tag so it cannot become `latest`.
Do not create a Git tag for the bootstrap version or run `.github/workflows/release.yml` for it.

The source package manifests remain `private: true` and versioned as `0.0.0`. The artifact helper
copies only approved package files into an ignored staging directory, changes only the staged
manifest version and workspace dependency versions, removes staged `private`, and emits checksummed
tarballs. It never publishes or reads a credential.

## Owners And Gates

- Registry owner: `0disoft`
- Plan source: `docs/ops/npm-bootstrap-plan.json`
- Artifact output: `.tmp/npm-bootstrap`
- Normal publisher: `.github/workflows/release.yml`, GitHub environment `npm`
- Credential boundary: an interactive npm owner session; no repository secret, workflow token,
  command-line token, copied OTP, project `.npmrc`, or logged credential value

The plan must remain `blocked` until the owner explicitly approves the one-time session. Changing
the plan status or running the artifact helper does not authorize publication by itself.

## Offline Preflight

Run from a clean checkout:

```powershell
pnpm run check
node scripts/check-npm-bootstrap-plan.mjs
node scripts/prepare-npm-bootstrap-artifacts.mjs --dry-run
```

The dry-run builds and validates all five staged tarballs under an operating-system temporary
directory, then deletes them. It does not contact npm or write reusable artifacts.

## Approval Commit

1. Record the current full commit SHA before changing the plan.
2. Change only `docs/ops/npm-bootstrap-plan.json`:
   - set `status` to `approved`;
   - set `approval.approvedBy` to `0disoft`;
   - set `approval.sourceCommit` to the full SHA recorded in step 1.
3. Commit that one-file approval change.
4. Keep the worktree clean. The artifact helper rejects any source change after the approved commit
   except the plan approval itself.

Before writing artifacts, use the optional read-only registry preflight:

```powershell
node scripts/check-npm-bootstrap-plan.mjs --registry-check
```

It verifies the authenticated npm identity is `0disoft` and every package name still returns E404.
It does not publish, mutate package settings, or print credential material.

## Prepare Artifacts

```powershell
node scripts/prepare-npm-bootstrap-artifacts.mjs --write
```

Review `.tmp/npm-bootstrap/manifest.json`. It records the current source commit, package order,
bootstrap version, dist-tag, tarball paths, and SHA-256 digests. `credentialIncluded` must be false.

## Owner-Only Publication

Start an interactive owner session. Do not place credentials or one-time codes in command
arguments, environment examples, repository files, screenshots, or logs.

Publish in dependency order using the generated filenames:

```powershell
npm publish .tmp/npm-bootstrap/artifacts/0disoft-mcp-security-proxy-contracts-0.0.0-bootstrap.0.tgz --access public --tag bootstrap
npm publish .tmp/npm-bootstrap/artifacts/0disoft-mcp-security-proxy-core-0.0.0-bootstrap.0.tgz --access public --tag bootstrap
npm publish .tmp/npm-bootstrap/artifacts/0disoft-mcp-security-proxy-mcp-adapter-0.0.0-bootstrap.0.tgz --access public --tag bootstrap
npm publish .tmp/npm-bootstrap/artifacts/0disoft-mcp-security-proxy-runtime-0.0.0-bootstrap.0.tgz --access public --tag bootstrap
npm publish .tmp/npm-bootstrap/artifacts/0disoft-mcp-security-proxy-cli-0.0.0-bootstrap.0.tgz --access public --tag bootstrap
```

If publication stops partway through, do not republish successful package versions. Verify each
name individually and continue only with the missing package in the recorded dependency order.

## Trusted Publisher Handoff

For every package, configure npm Trusted Publisher with these exact values:

- provider: GitHub Actions
- repository: `0disoft/mcp-security-proxy`
- workflow: `release.yml`
- environment: `npm`
- allowed action: npm publish

Then end and remove the bootstrap credential:

```powershell
npm logout --registry https://registry.npmjs.org
```

Verify the bootstrap version exists only under the `bootstrap` dist-tag, verify `latest` was not
created by bootstrap, and confirm the repository contains no project `.npmrc` or registry secret.

## Completion Record

After all five registry versions exist, all five Trusted Publishers are configured, and the
bootstrap credential is removed, change the plan to `completed` and record:

- `completion.completedBy`: `0disoft`
- `completion.sourceCommit`: the full commit used to prepare the artifacts
- `completion.registryEvidence`: a concise npm-view verification reference without credentials
- `completion.trustedPublisherConfigured`: `true`
- `completion.bootstrapCredentialRemoved`: `true`

After the first successful OIDC release, deprecate `0.0.0-bootstrap.0` with a message directing
users to the real alpha version. Do not unpublish or reuse the bootstrap version.

## Stop Conditions

- Any package name already exists before bootstrap.
- Authenticated npm identity is not `0disoft`.
- The plan is not approved or the worktree is dirty.
- A generated SHA-256 value changes after review.
- A tarball contains source tests, local config, credentials, logs, or unapproved paths.
- Any package is published under `latest` instead of `bootstrap`.
- Trusted Publisher fields do not exactly match the recorded GitHub repository, workflow, and
  environment.

Official npm setup details: <https://docs.npmjs.com/trusted-publishers/>.
