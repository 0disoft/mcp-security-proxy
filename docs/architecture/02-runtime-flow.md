# Runtime Flow

Status: Draft

## Startup Flow

1. CLI receives a profile name, policy path, server command or endpoint, and audit output path.
2. Policy file is parsed and validated.
3. Proxy starts the upstream MCP server or connects to it.
4. Proxy initializes MCP session negotiation without exposing unfiltered tools to the client.
5. Proxy prepares audit redaction and decision logging.

## Tool Discovery Flow

1. Upstream server returns tool descriptors.
2. Proxy classifies tool capabilities from explicit policy, tool name, description, and schema.
3. Proxy applies discovery filtering rules.
4. Client receives only tools allowed for discovery.
5. Proxy records a redacted discovery audit event.

## Tool Call Flow

1. Client sends a tool call.
2. Proxy normalizes policy inputs such as path, command, domain, and argument metadata.
3. Proxy evaluates deny rules before allow rules unless an ADR records a different order.
4. If denied, proxy returns an MCP-compatible error and does not forward the call.
5. If approval is required, proxy returns or triggers the host approval hook.
6. If allowed, proxy forwards the call to the upstream server.
7. Proxy redacts and writes the decision audit event.

## Failure Flow

- Invalid policy: startup fails with configuration error.
- Unclassified risky capability: call is denied by default.
- Audit write failure: policy must define whether to fail closed or continue with stderr warning.
- Upstream server crash: proxy returns upstream failure without converting it into policy success.
