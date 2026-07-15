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

Publication records must contain public registry metadata only. Never include npm credentials,
cookies, private logs, raw package contents, or local npm configuration.
