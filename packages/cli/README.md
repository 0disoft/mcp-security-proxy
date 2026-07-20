# @0disoft/mcp-security-proxy-cli

Deny-by-default local stdio proxy and policy inspection commands for MCP servers.

## Quick Start

Requires Node.js 24 or newer. Install exact published versions so the first run is reproducible:

```sh
npm install --global @0disoft/mcp-security-proxy-cli@0.2.0-alpha.4 @modelcontextprotocol/server-filesystem@2026.7.4
```

Create `/absolute/path/to/mcp-security-policy.json`. Replace both example paths with durable absolute
paths; relative paths are a bad fit for a host that may start MCP servers from different working
directories. On Windows, use forward slashes such as `C:/Users/you/mcp-share`.

```json
{
  "schemaVersion": "msp.policy.v1",
  "defaultAction": "deny",
  "methodPolicy": {
    "allowedMethods": ["initialize", "notifications/initialized", "ping", "tools/list", "tools/call"],
    "denyUnsupported": true
  },
  "profiles": [
    {
      "id": "secured-filesystem",
      "defaultAction": "deny",
      "rules": [
        {
          "id": "allow-shared-read",
          "action": "allow",
          "tools": ["read_text_file"],
          "paths": {
            "allowedRoots": ["/absolute/path/to/mcp-share"]
          }
        },
        {
          "id": "deny-file-write",
          "action": "deny",
          "capabilities": ["file-write"]
        },
        {
          "id": "deny-shell",
          "action": "deny",
          "capabilities": ["shell"]
        }
      ],
      "audit": {
        "destination": "file",
        "path": "/absolute/path/to/mcp-security-proxy.audit.jsonl",
        "onFailure": "fail_closed",
        "includeRawArguments": false,
        "includeFullPaths": false
      }
    }
  ]
}
```

Validate the policy before registering the server:

```sh
mcp-security-proxy check-policy --policy /absolute/path/to/mcp-security-policy.json --json
```

Generate a host-neutral descriptor without modifying host configuration files:

```sh
mcp-security-proxy config-snippet --target stdio-json --policy /absolute/path/to/mcp-security-policy.json --profile secured-filesystem -- mcp-server-filesystem /absolute/path/to/mcp-share
```

For Codex, inspect the read-only registration descriptor first:

```sh
mcp-security-proxy config-snippet --target codex-cli-json --name secured-filesystem --policy /absolute/path/to/mcp-security-policy.json --profile secured-filesystem -- mcp-server-filesystem /absolute/path/to/mcp-share
```

When the descriptor is correct, this manual command writes the active Codex MCP configuration:

```sh
codex mcp add secured-filesystem -- mcp-security-proxy run --policy /absolute/path/to/mcp-security-policy.json --profile secured-filesystem -- mcp-server-filesystem /absolute/path/to/mcp-share
```

For Gemini, generate the project-scoped descriptor without editing `.gemini/settings.json`:

```sh
mcp-security-proxy config-snippet --target gemini-cli-json --name secured-filesystem --policy /absolute/path/to/mcp-security-policy.json --profile secured-filesystem -- mcp-server-filesystem /absolute/path/to/mcp-share
```

On Windows, some hosts cannot launch npm's `.cmd` shims directly. Register the underlying JavaScript
entrypoints through Node.js instead; this is also the path exercised by the registry onboarding
smoke:

```powershell
$globalRoot = (npm root --global).Trim()
$proxyEntry = Join-Path $globalRoot '@0disoft\mcp-security-proxy-cli\dist\main.js'
$serverEntry = Join-Path $globalRoot '@modelcontextprotocol\server-filesystem\dist\index.js'
$policyPath = (Resolve-Path 'C:\Users\you\mcp-security-policy.json').Path
$sharedRoot = (Resolve-Path 'C:\Users\you\mcp-share').Path
codex mcp add secured-filesystem -- node $proxyEntry run --policy $policyPath --profile secured-filesystem -- node $serverEntry $sharedRoot
```

Windows `run` uses the operating system's Windows PowerShell to establish a Job Object before it
starts the MCP server. If that fail-closed containment step is unavailable, the CLI exits before
upstream startup. Normal shutdown uses the configured grace period; abrupt proxy termination closes
the Job and reclaims the upstream process tree.

Policy watching is opt-in. Add `--watch-policy` before the upstream `--` when the host should pick
up validated file replacements without restarting the MCP server:

```sh
mcp-security-proxy run --policy /absolute/path/to/mcp-security-policy.json --profile secured-filesystem --watch-policy -- mcp-server-filesystem /absolute/path/to/mcp-share
```

Save through an atomic file replacement when possible. A valid replacement keeps the same active
profile and audit settings, clears remembered tool visibility, and requires fresh discovery.
Invalid or audit-changing replacements leave the previous policy active. Pending approval hooks
fail closed on replacement; already-forwarded upstream calls continue.

Operational metrics can be toggled without restarting the proxy by combining `--ops-log` with an
OpenFeature snapshot:

```sh
mcp-security-proxy run --policy /absolute/path/to/mcp-security-policy.json --profile secured-filesystem --ops-log /absolute/path/to/mcp-security-proxy.ops.jsonl --ops-feature-flags /absolute/path/to/ops-flags.json -- mcp-server-filesystem /absolute/path/to/mcp-share
```

The snapshot boolean key is `mcp.ops.metrics.enabled`. Valid replacements apply through provider
configuration-change events; invalid replacements keep the last valid value. This switch controls
only the optional ops JSONL stream. It never changes visible tools, allow/deny decisions, approval
hooks, audit writes, or process containment.

Restart or reload the host, then confirm only `read_text_file` is visible and that reads outside the
configured lexical path are denied. The proxy checks MCP messages and arguments; it is not an
operating-system sandbox, does not resolve symlinks or Windows junctions, and does not bundle a host
approval UI. Do not use a sensitive directory as the upstream filesystem root.

See the [CLI command contract](https://github.com/0disoft/mcp-security-proxy/blob/main/docs/cli/command-contract.md).
