import type { PolicyDocument } from "@0disoft/mcp-security-proxy-contracts";

export interface ProxyStartupPlanInput {
  readonly profileId: string;
  readonly policy: PolicyDocument;
  readonly upstreamCommand: readonly string[];
  readonly auditDestination: string;
}

export interface ProxyStartupPlan {
  readonly profileId: string;
  readonly upstreamExecutable: string;
  readonly upstreamArgv: readonly string[];
  readonly auditDestination: string;
  readonly supportedMethods: readonly string[];
}

export function createProxyStartupPlan(input: ProxyStartupPlanInput): ProxyStartupPlan {
  const [upstreamExecutable, ...upstreamArgv] = input.upstreamCommand;
  if (!upstreamExecutable) {
    throw new Error("upstream command must include an executable");
  }

  return {
    profileId: input.profileId,
    upstreamExecutable,
    upstreamArgv,
    auditDestination: input.auditDestination,
    supportedMethods: input.policy.methodPolicy.allowedMethods
  };
}
