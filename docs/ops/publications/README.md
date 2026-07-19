# Publication Records

Status: Draft

This directory stores immutable post-publication receipts. Release readiness records approve what
may be published; publication records describe what was actually observed after npm accepted the
immutable version.

Each `*.publication.json` record must name the approved release record, release tag and commit,
successful GitHub Actions release run, successful registry smoke run, observed npm dist-tags, and
the exact integrity and SLSA provenance evidence for every published package. Do not rewrite an
older approval record to add evidence that only existed after publication.

`pnpm run release-readiness` validates publication receipts offline. It proves that the tracked
record is internally consistent and tied to the approved package set; it does not replace the
networked `pnpm run registry-smoke -- --version <exact-semver>` check.

The normal evidence path is:

1. Manually dispatch **Registry Smoke** with the exact published version and the successful
   **Release** workflow run ID for that version.
2. Registry Smoke verifies the public packages and exposes those two inputs only in its structured
   run name.
3. After that run completes successfully, the read-only **Publication Receipt** workflow verifies
   both GitHub Actions runs, resolves the immutable release tag, reads all five npm package records,
   checks one consistent `latest` tag and the bootstrap-plan version, and uploads
   `<version>.publication.json` as a 30-day workflow artifact.
4. Download the artifact, review it, copy it to
   `docs/ops/publications/<version>.publication.json`, run `pnpm run release-readiness`, and commit
   the immutable record. The workflow deliberately has no repository write permission.

For local recovery or reproduction after both runs have completed, use an unused output path:

```powershell
node scripts/generate-publication-receipt.mjs --version <exact-semver> --release-run-id <id> --registry-smoke-run-id <id> --output tmp/<exact-semver>.publication.json
```

The generator refuses dist-tags and semver ranges, failed or mismatched workflow runs, a Release
run not bound to the version tag commit, package-set drift, missing integrity or provenance, and an
unexpected `bootstrap` tag, or an existing output file. A generated artifact is evidence ready for
review; it is not tracked evidence until the reviewed JSON is committed under this directory.

Publication records must contain public registry metadata only. Never include npm credentials,
cookies, private logs, raw package contents, or local npm configuration.
