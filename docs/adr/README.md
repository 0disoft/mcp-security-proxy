# Architecture Decisions

Status: Draft
Owner: 0disoft

## Purpose

Track durable architecture decisions for MCP Security Proxy.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Technical owner: 0disoft
- Related ADR: this directory

## Current ADRs

- 0001: initial protocol-boundary architecture
- 0002: contract source of truth
- 0003: open source license and private data boundary
- 0004: implementation stack direction
- 0005: external MCP compatibility target
- 0006: lexical path policy boundary
- 0007: external client compatibility matrix
- 0008: runtime MCP SDK boundary
- 0009: Codex configuration adapter
- 0010: Gemini CLI configuration adapter
- 0011: second external MCP server target

## Review Blockers

- The change adds durable behavior without an ADR when it affects policy, audit, CLI, library,
  release, security, or compatibility boundaries.
- The change weakens validation or skips required evidence.
- The change relies on generated, cache, or build output as source truth.
