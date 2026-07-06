# Domain Model

Status: Draft

## Core Entities

- Proxy Profile: named configuration for one MCP server and its policy.
- MCP Server: upstream process or endpoint that exposes tools.
- Tool Descriptor: tool name, description, input schema, and inferred capability labels.
- Capability: policy-relevant behavior such as file-read, file-write, shell, network, secret,
  database, browser, workflow, or unknown.
- Policy Rule: allow, deny, or approval requirement matched by server, tool, capability, path,
  command, network domain, or argument shape.
- Tool Call: one requested invocation with arguments and request metadata.
- Decision: allow, deny, or approval-required result with rule evidence.
- Redactor: detector and replacement policy applied before audit output.
- Audit Event: redacted record of discovery, evaluation, decision, and errors.

## Ownership

The proxy owns policy evaluation and audit event formatting. The MCP server owns actual tool
execution. The host owns user approval UX, process lifecycle, and any stronger OS-level sandboxing.

## Invariants

- Unknown capability must not be silently treated as safe.
- Denied calls must not be forwarded upstream.
- Audit events must not contain raw secret values.
- Policy evaluation should be deterministic for the same policy, tool descriptor, and call.
- Tool discovery filtering must not invent tools.
