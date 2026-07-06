# Contract Source of Truth

Status: Draft
Owner: 0disoft

## Purpose

Record where MCP Security Proxy contracts live while implementation choices remain unsettled.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: docs/README.md

## Required Decisions

- Boundary: docs/product, docs/architecture, docs/cli, docs/library, docs/engineering, and docs/ops
  own stable contracts until code exists.
- Data ownership: generated output, cache output, and local run artifacts are never source truth.
- Failure and recovery behavior: contract drift blocks release until the source-of-truth document,
  examples, validation, and migration notes agree.
- Validation needed before merge: VALIDATION.md

## Decision

- Product scope lives in docs/product/02-spec.md.
- Protocol and architecture boundaries live in docs/architecture.
- Durable decisions live in docs/adr.
- CLI command behavior lives in docs/cli.
- Library API and package compatibility live in docs/library.
- Security, testing, dependency, and performance standards live in docs/engineering.
- Release, secrets, and incident operation notes live in docs/ops.
- Security reporting lives in SECURITY.md.
- License text lives in LICENSE.

## Review Blockers

- The change updates one contract surface while leaving dependent docs stale.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
