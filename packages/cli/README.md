# @0disoft/mcp-security-proxy-cli

Deny-by-default local stdio proxy and policy inspection commands for MCP servers.

```sh
npm install --global @0disoft/mcp-security-proxy-cli
mcp-security-proxy --help
```

Generate a host-neutral stdio descriptor without modifying host configuration files:

```sh
mcp-security-proxy config-snippet --target stdio-json --policy ./policy.json --profile local -- node server.js
```

Generate Codex registration argv without editing Codex configuration:

```sh
mcp-security-proxy config-snippet --target codex-cli-json --name secured-filesystem --policy ./policy.json --profile local -- node server.js
```

The CLI controls MCP discovery and tool calls at the protocol boundary. It is not an
operating-system sandbox and does not bundle a host approval UI.

See the [CLI command contract](https://github.com/0disoft/mcp-security-proxy/blob/main/docs/cli/command-contract.md).
