# Runtime Flow

Status: Draft

## Startup Flow

1. CLI receives a profile name, policy path, server command or endpoint, and audit output path.
2. Policy file is parsed and validated.
3. Proxy starts the upstream MCP server or connects to it.
4. Proxy initializes MCP session negotiation through the supported method policy.
5. Proxy prepares audit redaction and decision logging.

## Method Policy Flow

1. Proxy receives an MCP message.
2. Proxy checks the method against the supported MVP method set.
3. Supported methods continue to method-specific handling.
4. Unsupported methods return an MCP-compatible denial and are not forwarded upstream.
5. Proxy records a redacted method-denial audit event.

## Tool Discovery Flow

1. Upstream server returns tool descriptors.
2. Proxy classifies tool capabilities from explicit policy, tool name, description, and schema.
3. Proxy applies discovery filtering rules.
4. Client receives only tools allowed for discovery.
5. Proxy records a redacted discovery audit event.

## Tool Call Flow

1. Client sends a tool call.
2. Proxy normalizes policy inputs such as path, command, domain, and argument metadata.
3. Proxy evaluates method policy, deny rules, approval rules, allow rules, then default deny.
4. If denied, proxy returns an MCP-compatible error and does not forward the call.
5. If approval is required and no host approval hook exists, proxy denies the call.
6. If allowed, proxy forwards the call to the upstream server.
7. Proxy redacts and writes the decision audit event.

## Failure Flow

- Invalid policy: startup fails with configuration error.
- Unclassified risky capability: call is denied by default.
- Unsupported method: request is denied by default and is not passed through.
- Audit write failure: fail closed by default; policy may explicitly choose warn-and-continue.
- Upstream server crash: proxy returns upstream failure without converting it into policy success.
