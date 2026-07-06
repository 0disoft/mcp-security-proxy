export interface CommandContract {
  readonly name: "run" | "check-policy" | "inspect-tools" | "eval-call";
  readonly description: string;
  readonly forwardsToolCalls: boolean;
}

export function createCommandRegistry(): readonly CommandContract[] {
  return [
    {
      name: "run",
      description: "run an MCP server behind the proxy",
      forwardsToolCalls: true
    },
    {
      name: "check-policy",
      description: "validate policy syntax and contract shape",
      forwardsToolCalls: false
    },
    {
      name: "inspect-tools",
      description: "classify tool descriptors without forwarding calls",
      forwardsToolCalls: false
    },
    {
      name: "eval-call",
      description: "evaluate one captured tool call without forwarding it",
      forwardsToolCalls: false
    }
  ];
}
