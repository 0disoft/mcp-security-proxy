# Agent Plugins installable demo

Status: installable self-contained demo, not a general production proxy preset.

This directory implements the Agent Plugins 1.0.0 `plugin.json` and `mcp.json` shape. It packages a
deny-by-default policy and a fixed, side-effect-free MCP server so the compatibility artifact can be
installed and run without an MCP Security Proxy repository checkout.

## Install

Copy this directory to the location accepted by an Agent Plugins-compatible host, then install the
pinned runtime dependency inside the copied directory:

```sh
npm install --omit=dev --ignore-scripts
```

The host expands `${PLUGIN_ROOT}` to this directory and `${PLUGIN_DATA}` to its writable per-plugin
data directory. The proxy code, policy, and demo upstream resolve under `${PLUGIN_ROOT}`; the
redacted audit log is written only under `${PLUGIN_DATA}`.

## Boundary

The included `demo_status` tool returns a fixed string and does not read arguments, files,
environment variables, or the network. The policy denies every other tool by default. This proves
portable packaging and proxy mediation; it is not a production policy for an arbitrary upstream MCP
server.

Agent Plugins 1.0.0 standardizes packaging and discovery. It does not define marketplace
acceptance, host permissions, dependency installation, or runtime lifecycle. A real deployment must
choose its upstream server and policy, then validate those choices independently.

`pnpm run compatibility` checks the tracked package shape. The repository's
`external-compatibility` validation retrieves the official schemas, validates both manifests live,
installs a clean copy from its lock file, and exercises MCP initialization, tool discovery, the
allowed call, and the `${PLUGIN_DATA}` audit destination.
