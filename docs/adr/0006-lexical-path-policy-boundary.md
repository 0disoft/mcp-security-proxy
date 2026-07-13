# Lexical Path Policy Boundary

Status: Accepted
Owner: 0disoft

## Purpose

Define exactly what path policy proves today and prevent argument-level path matching from being
described as filesystem containment, symlink enforcement, or proof of the file an upstream MCP
server eventually opens.

## Source of Truth

- Product decision: docs/product/02-spec.md
- Policy model: docs/architecture/04-policy-model.md
- Security baseline: docs/engineering/04-security-baseline.md
- Threat model: docs/engineering/08-threat-model.md
- Related ADR: docs/adr/0001-initial-architecture-boundaries.md

## Decision

The implemented path policy mode is `lexical`. It evaluates path strings extracted from MCP tool
arguments. It does not call filesystem APIs and does not observe or control the later filesystem
operation performed by the upstream server.

Lexical normalization:

- trims surrounding whitespace;
- requires NFC Unicode;
- converts backslashes to forward slashes and collapses repeated separators;
- removes `.` segments;
- lowercases only a Windows drive-letter prefix;
- rejects NUL bytes, `..` traversal segments, encoded separators, home expansion, and UNC-style
  leading double separators;
- compares the remaining string against configured roots by exact segment boundary.

All other filesystem semantics remain outside the lexical decision. In particular, an allow
decision does not prove:

- a relative path is interpreted from the expected working directory;
- a symlink, Windows junction, mount point, bind mount, or reparse point stays inside a root;
- filesystem case folding matches the case-sensitive lexical comparison;
- a non-existent write target will be created below the inspected parent;
- the target is unchanged between policy evaluation and use;
- the upstream server opens the path that appeared in the MCP argument.

## Future Host Attestation API

A future embedding API may add host-attested path facts. That API must use an explicit contract
rather than silently replacing lexical facts:

- input: operation class (`read`, `write`, or `metadata`) and the extracted lexical path;
- result: `attested`, `denied`, `unavailable`, or `error`;
- attested evidence: canonical host path, filesystem identity when available, resolution time, and
  whether the target or only its nearest existing parent was inspected;
- failure behavior: `denied`, `unavailable`, timeout, malformed output, and resolver error all fail
  closed for rules requiring host attestation;
- privacy: raw and canonical paths remain policy inputs and must not be copied into audit events;
- concurrency: attestation must be bounded and cancellation-aware.

Host attestation may strengthen an argument-intent decision, but it is not containment. A stronger
claim requires the host or OS boundary to ensure the upstream operation uses the attested object,
handle, sandbox, or capability. A check followed by an unconstrained upstream open remains subject
to time-of-check/time-of-use replacement and server substitution.

No host attestation callback is implemented or exported by this ADR. Adding one requires a public
API change, timeout and cancellation tests, privacy review, compatibility fixtures, and migration
notes.

## Alternatives Rejected

- Calling `realpath` inside the IO-free core evaluator: breaks the package boundary and still
  cannot prove what the upstream server opens.
- Resolving paths in CLI and calling the result containment: vulnerable to later replacement and
  unavailable for non-existent write targets without a broader contract.
- Treating normalized strings as canonical filesystem paths: false on case-insensitive filesystems,
  symlinks, junctions, mounts, and platform-specific namespaces.
- Silently denying every relative path: potentially useful as a future stricter profile, but a
  behavior change that requires policy migration rather than a documentation patch.

## Compatibility and Migration

This ADR does not change matcher behavior or the `msp.policy.v1` schema. Existing policies continue
to receive lexical decisions. Documentation and product claims must use `lexical path matching` and
must not say realpath, symlink, or OS-level containment is enforced.

Future host-attested rules must be opt-in and must not reinterpret existing lexical allow rules.
Absent attestation cannot turn a deny into an allow.

## Review Blockers

- A change describes lexical matching as filesystem containment or sandboxing.
- A change claims symlink, junction, mount, case-folding, missing-target, or TOCTOU enforcement
  without an implementation and fixture evidence.
- A resolver failure, timeout, or unavailable result becomes an allow.
- Raw or canonical path values are added to audit events.
- A host attestation API is exported without migration, compatibility, timeout, and cancellation
  coverage.
