export const POLICY_SCHEMA_VERSION = "msp.policy.v1" as const;

export const MVP_ALLOWED_METHODS = [
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "tools/call"
] as const;

export type PolicySchemaVersion = typeof POLICY_SCHEMA_VERSION;
export type MvpAllowedMethod = (typeof MVP_ALLOWED_METHODS)[number];
export type PolicyAction = "allow" | "deny" | "approval_required";
export type DefaultAction = "deny";

export type Capability =
  | "file-read"
  | "file-write"
  | "shell"
  | "network"
  | "secret"
  | "database"
  | "browser"
  | "workflow"
  | "unknown";

export interface MethodPolicy {
  readonly allowedMethods: readonly string[];
  readonly denyUnsupported: boolean;
}

export interface PathRule {
  readonly allowedRoots?: readonly string[];
  readonly deniedRoots?: readonly string[];
}

export interface CommandRule {
  readonly executable: string;
  readonly argv?: readonly string[];
}

export interface NetworkRule {
  readonly domains?: readonly string[];
  readonly ips?: readonly string[];
}

export interface PolicyRule {
  readonly id: string;
  readonly action: PolicyAction;
  readonly tools?: readonly string[];
  readonly capabilities?: readonly Capability[];
  readonly methods?: readonly string[];
  readonly paths?: PathRule;
  readonly commands?: readonly CommandRule[];
  readonly networks?: readonly NetworkRule[];
}

export interface AuditPolicy {
  readonly destination: "file" | "stdout";
  readonly path?: string;
  readonly onFailure: "fail_closed" | "warn_and_continue";
  readonly includeRawArguments: false;
  readonly includeFullPaths: boolean;
}

export interface RedactionDetector {
  readonly id: string;
  readonly kind: "secret_like" | "environment_value" | "path" | "prompt";
  readonly replacement: string;
}

export interface RedactionPolicy {
  readonly detectors: readonly RedactionDetector[];
}

export interface ServerProfile {
  readonly id: string;
  readonly defaultAction: DefaultAction;
  readonly rules: readonly PolicyRule[];
  readonly audit: AuditPolicy;
}

export interface PolicyDocument {
  readonly schemaVersion: PolicySchemaVersion;
  readonly defaultAction: DefaultAction;
  readonly methodPolicy: MethodPolicy;
  readonly profiles: readonly ServerProfile[];
  readonly redaction?: RedactionPolicy;
}

export function createDenyByDefaultPolicy(profileId = "default"): PolicyDocument {
  return {
    schemaVersion: POLICY_SCHEMA_VERSION,
    defaultAction: "deny",
    methodPolicy: {
      allowedMethods: MVP_ALLOWED_METHODS,
      denyUnsupported: true
    },
    profiles: [
      {
        id: profileId,
        defaultAction: "deny",
        rules: [],
        audit: {
          destination: "stdout",
          onFailure: "fail_closed",
          includeRawArguments: false,
          includeFullPaths: false
        }
      }
    ]
  };
}
