# Publication Records

Status: Draft

This directory stores immutable post-publication facts. Release readiness records approve what may
be published; publication records describe what was actually observed after npm accepted the
immutable version. Historical `msp.publication-record.v1` receipts remain valid and unchanged.
`msp.publication-record.v2` adds independently observed GitHub Release evidence. A schema upgrade
may only append re-observed evidence while preserving every original publication fact and recording
the later observation time; the alpha.4 receipt is the one-time v2 backfill after its Release was
created.

The Draft 2020-12 schemas are
`schemas/publication-record.v1.schema.json` and `schemas/publication-record.v2.schema.json`.
Fixed positive fixtures live under `fixtures/publications/`. `pnpm run schema-contract` compiles
both schemas with Ajv, accepts both fixtures, and proves that v1 rejects v2-only evidence while v2
requires GitHub Release evidence and rejects unknown top-level fields.

Each `*.publication.json` record must name the approved release record, release tag and commit,
successful GitHub Actions release run, successful registry smoke run, observed npm dist-tags, and
the exact integrity and SLSA provenance evidence for every published package. A v2 record also pins
the GitHub Release ID, public URL, tag commit, draft and prerelease state, publication time, and the
time those Release facts were observed. Do not rewrite an older approval record to add evidence that
only existed after publication.

`pnpm run release-readiness` validates publication receipts offline. It proves that the tracked
record is internally consistent and tied to the approved package set; it does not replace the
networked `pnpm run registry-smoke -- --version <exact-semver>` check.

Schema validation and semantic validation are separate gates. JSON Schema owns closed object shapes,
primitive types, fixed workflow names, URL patterns, RFC 3339 timestamps, and the v1/v2 field split.
The JavaScript checker retains cross-field rules such as tag/version equality, commit linkage,
chronology, exact approved package membership, dist-tag consistency, and provenance run linkage.

The normal evidence path is:

1. Manually dispatch **Registry Smoke** with the exact published version and the successful
   **Release** workflow run ID for that version.
2. Registry Smoke verifies the public packages and exposes those two inputs only in its structured
   run name.
3. After that run completes successfully, the read-only **Publication Receipt** workflow verifies
   both GitHub Actions runs, resolves the immutable release tag, verifies the published GitHub
   Release ID, URL, channel, and publication time, reads all five npm package records, checks one
   consistent `latest` tag and the bootstrap-plan version, and uploads
   `<version>.publication.json` as a 30-day workflow artifact.
4. Download the artifact and review it. From the repository root, a human operator may run the
   manual-only import command below. It revalidates the receipt and writes only the immutable
   `docs/ops/publications/<version>.publication.json` path; it never stages, commits, pushes, or
   performs network requests. Then run the repository's configured release-readiness validation
   and commit the reviewed record. The workflow deliberately has no repository write permission.

```powershell
node scripts/import-publication-receipt.mjs --version <exact-semver> --input <downloaded-json>
```

The importer requires the operator to repeat the exact version, rejects symbolic links, non-files,
file replacement between inspection and open, malformed UTF-8, invalid or oversized JSON,
filename/version drift, schema or semantic drift, missing approval records, and any destination
that already exists. It canonicalizes the accepted JSON, creates the destination without overwrite,
prints its SHA-256 digest, and leaves Git state untouched.

For manual-only local recovery or reproduction after both runs have completed, use an unused
output path:

```powershell
node scripts/generate-publication-receipt.mjs --version <exact-semver> --release-run-id <id> --registry-smoke-run-id <id> --output tmp/<exact-semver>.publication.json
```

The generator refuses dist-tags and semver ranges, failed or mismatched workflow runs, a Release
run not bound to the version tag commit, a missing/draft/mismatched GitHub Release, package-set drift,
missing integrity or provenance, an unexpected `bootstrap` tag, or an existing output file. A
generated artifact is evidence ready for review; it is not tracked evidence until the reviewed JSON
is committed under this directory.

Publication records must contain public registry metadata only. Never include npm credentials,
cookies, private logs, raw package contents, or local npm configuration.
