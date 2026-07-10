# @0disoft/mcp-security-proxy-cli

Deny-by-default local stdio proxy and policy inspection commands for MCP servers.

```sh
npm install --global @0disoft/mcp-security-proxy-cli
mcp-security-proxy --help
```

The CLI controls MCP discovery and tool calls at the protocol boundary. It is not an
operating-system sandbox and does not bundle a host approval UI.

See the [CLI command contract](https://github.com/0disoft/mcp-security-proxy/blob/main/docs/cli/command-contract.md).
