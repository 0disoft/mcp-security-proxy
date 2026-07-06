# Domain Model

Status: Draft

## Core Entities

- Proxy Profile: named configuration for one MCP server and its policy.
- MCP Server: upstream process or endpoint that exposes tools.
- MCP Method: protocol method name such as `initialize`, `tools/list`, or `tools/call`.
- Method Policy: allow or deny rule for one method or method family before payload-specific
  evaluation.
- Tool Descriptor: tool name, description, input schema, and inferred capability labels.
- Classifier Evidence: heuristic evidence from explicit policy, tool name, description, schema, and
  captured examples.
- Capability: policy-relevant behavior such as file-read, file-write, shell, network, secret,
  database, browser, workflow, or unknown.
- Policy Rule: allow, deny, or approval requirement matched by server, tool, capability, path,
  command, network domain, or argument shape.
- Normalized Tool Call: one requested invocation with raw payload reduced to policy facts and
  redacted metadata.
- Decision: allow, deny, or approval-required result with rule evidence.
- Redactor: detector and replacement policy applied before audit output.
- Approval Hook: optional host-owned callback for approval-required decisions.
- Audit Sink: local destination that accepts redacted audit events only.
- Audit Event: redacted record of discovery, evaluation, decision, and errors.

## Ownership

The proxy owns policy evaluation and audit event formatting. The MCP server owns actual tool
execution. The host owns user approval UX, process lifecycle, and any stronger OS-level sandboxing.

## Invariants

- Unknown capability must not be silently treated as safe.
- Unsupported MCP method must not be silently passed through.
- Denied calls must not be forwarded upstream.
- Audit events must not contain raw secret values.
- Audit writers must receive redacted summaries rather than raw MCP payloads.
- Policy evaluation should be deterministic for the same policy, tool descriptor, and call.
- Tool discovery filtering must not invent tools.
- Core policy logic should not depend on runtime IO, subprocess control, or a specific MCP SDK.
