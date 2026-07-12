import type { Capability, PolicyRule } from "@0disoft/mcp-security-proxy-contracts";

export function toolHasNonDenyPolicyCoverage(
  rules: readonly PolicyRule[],
  toolName: string,
  capabilities: readonly Capability[]
): boolean {
  if (capabilities.length === 0 || capabilities.includes("unknown")) {
    return false;
  }

  return capabilities.every((capability) =>
    rules.some(
      (rule) =>
        rule.action !== "deny" &&
        (rule.tools?.includes(toolName) === true || rule.capabilities?.includes(capability) === true)
    )
  );
}
