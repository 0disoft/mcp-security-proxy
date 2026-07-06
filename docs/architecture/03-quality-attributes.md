# Quality Attributes

Status: Draft

## Security

- Default policy posture is deny unless an explicit rule allows the capability.
- Unknown or ambiguous tool capability is not considered safe.
- File, shell, network, and secret-sensitive behavior require dedicated policy paths.
- The proxy must not describe itself as a complete OS sandbox.

## Privacy

- Audit logs must be redacted before write.
- Raw environment values, secret-like strings, and full sensitive arguments must not be retained.
- Redaction summaries should count replacements without storing original values.

## Operability

- Denials should be explainable from policy and capability evidence.
- Policy parse errors should fail before proxy startup.
- Audit write failures must have a documented fail-closed or warn-and-continue policy.
- Dry-run evaluation should support policy review without executing tools.

## Compatibility

- stdio MCP behavior is the first compatibility target.
- HTTP transport support is deferred until stdio behavior is fixture-backed.
- Tool classification should be testable from captured tool descriptors.
- Output contracts must be stable enough for host integrations and automated tests.

## Maintainability

- CLI and library contracts must evolve together.
- Policy schema changes must include migration notes.
- Audit schema changes must be versioned or explicitly documented.
