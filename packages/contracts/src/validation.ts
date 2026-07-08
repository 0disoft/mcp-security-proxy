import {
  MVP_ALLOWED_METHODS,
  POLICY_SCHEMA_VERSION,
  type Capability,
  type PolicyDocument,
  type PolicyRule
} from "./policy.js";
import {
  DECISION_SCHEMA_VERSION,
  type ArgumentFact,
  type NormalizedToolCall
} from "./decision.js";
import { AUDIT_EVENT_SCHEMA_VERSION } from "./audit.js";

export type ValidationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly errors: readonly [];
    }
  | {
      readonly ok: false;
      readonly errors: readonly string[];
    };

export function parsePolicyDocumentJson(text: string): ValidationResult<PolicyDocument> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return invalid("policy JSON is invalid");
  }
  return validatePolicyDocument(parsed);
}

const capabilities = new Set<Capability>([
  "file-read",
  "file-write",
  "shell",
  "network",
  "secret",
  "database",
  "browser",
  "workflow",
  "unknown"
]);

export function validatePolicyDocument(value: unknown): ValidationResult<PolicyDocument> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return invalid("policy must be an object");
  }

  validateKnownProperties(value, "policy", ["schemaVersion", "defaultAction", "methodPolicy", "profiles", "redaction"], errors);
  if (value["schemaVersion"] !== POLICY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${POLICY_SCHEMA_VERSION}`);
  }
  if (value["defaultAction"] !== "deny") {
    errors.push("defaultAction must be deny");
  }

  const methodPolicy = value["methodPolicy"];
  if (!isRecord(methodPolicy)) {
    errors.push("methodPolicy must be an object");
  } else {
    validateKnownProperties(methodPolicy, "methodPolicy", ["allowedMethods", "denyUnsupported"], errors);
    const allowedMethods = methodPolicy["allowedMethods"];
    if (!Array.isArray(allowedMethods) || allowedMethods.length === 0) {
      errors.push("methodPolicy.allowedMethods must be a non-empty array");
    } else {
      const seenMethods = new Set<string>();
      for (const method of allowedMethods) {
        if (typeof method !== "string" || !MVP_ALLOWED_METHODS.includes(method as never)) {
          errors.push(`unsupported method in methodPolicy.allowedMethods: ${String(method)}`);
          continue;
        }
        if (seenMethods.has(method)) {
          errors.push(`duplicate method in methodPolicy.allowedMethods: ${method}`);
        }
        seenMethods.add(method);
      }
    }
    if (methodPolicy["denyUnsupported"] !== true) {
      errors.push("methodPolicy.denyUnsupported must be true");
    }
  }

  const profiles = value["profiles"];
  if (!Array.isArray(profiles) || profiles.length === 0) {
    errors.push("profiles must be a non-empty array");
  } else {
    const seenProfileIds = new Set<string>();
    for (const [profileIndex, profile] of profiles.entries()) {
      if (!isRecord(profile)) {
        errors.push(`profiles[${profileIndex}] must be an object`);
        continue;
      }
      validateKnownProperties(profile, `profiles[${profileIndex}]`, ["id", "defaultAction", "rules", "audit"], errors);
      if (!isNonEmptyString(profile["id"])) {
        errors.push(`profiles[${profileIndex}].id must be a non-empty string`);
      } else if (seenProfileIds.has(profile["id"])) {
        errors.push(`duplicate profile id: ${profile["id"]}`);
      } else {
        seenProfileIds.add(profile["id"]);
      }
      if (profile["defaultAction"] !== "deny") {
        errors.push(`profiles[${profileIndex}].defaultAction must be deny`);
      }
      validateRules(profile["rules"], `profiles[${profileIndex}].rules`, errors);
      validateAudit(profile["audit"], `profiles[${profileIndex}].audit`, errors);
    }
  }

  validateRedaction(value["redaction"], "redaction", errors);

  return errors.length === 0 ? valid(value as unknown as PolicyDocument) : invalid(...errors);
}

export function validateNormalizedToolCall(value: unknown): ValidationResult<NormalizedToolCall> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return invalid("tool call must be an object");
  }

  if (value["method"] !== "tools/call") {
    errors.push("tool call method must be tools/call");
  }
  if (!isNonEmptyString(value["toolName"])) {
    errors.push("toolName must be a non-empty string");
  }

  const valueCapabilities = value["capabilities"];
  if (!Array.isArray(valueCapabilities) || valueCapabilities.length === 0) {
    errors.push("capabilities must be a non-empty array");
  } else {
    for (const capability of valueCapabilities) {
      if (typeof capability !== "string" || !capabilities.has(capability as Capability)) {
        errors.push(`unsupported capability: ${String(capability)}`);
      }
    }
  }

  const argumentFacts = value["argumentFacts"];
  if (!Array.isArray(argumentFacts)) {
    errors.push("argumentFacts must be an array");
  } else {
    for (const [index, fact] of argumentFacts.entries()) {
      validateArgumentFact(fact, `argumentFacts[${index}]`, errors);
    }
  }

  return errors.length === 0 ? valid(value as unknown as NormalizedToolCall) : invalid(...errors);
}

export function validateToolListCapture(value: unknown): ValidationResult<{
  readonly tools: readonly { readonly name: string; readonly description?: string }[];
}> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return invalid("tool list capture must be an object");
  }

  const tools = value["tools"];
  if (!Array.isArray(tools)) {
    errors.push("tools must be an array");
  } else {
    for (const [index, tool] of tools.entries()) {
      if (!isRecord(tool)) {
        errors.push(`tools[${index}] must be an object`);
        continue;
      }
      if (!isNonEmptyString(tool["name"])) {
        errors.push(`tools[${index}].name must be a non-empty string`);
      }
      if (tool["description"] !== undefined && typeof tool["description"] !== "string") {
        errors.push(`tools[${index}].description must be a string when present`);
      }
    }
  }

  return errors.length === 0
    ? valid(value as { readonly tools: readonly { readonly name: string; readonly description?: string }[] })
    : invalid(...errors);
}

export function knownSchemaVersions(): readonly string[] {
  return [POLICY_SCHEMA_VERSION, DECISION_SCHEMA_VERSION, AUDIT_EVENT_SCHEMA_VERSION];
}

function validateRules(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }

  const seenRuleIds = new Set<string>();
  for (const [index, rule] of value.entries()) {
    const rulePath = `${path}[${index}]`;
    if (!isRecord(rule)) {
      errors.push(`${rulePath} must be an object`);
      continue;
    }
    validateKnownProperties(
      rule,
      rulePath,
      ["id", "action", "tools", "capabilities", "methods", "paths", "commands", "networks", "secrets"],
      errors
    );
    if (!isNonEmptyString(rule["id"])) {
      errors.push(`${rulePath}.id must be a non-empty string`);
    } else if (seenRuleIds.has(rule["id"])) {
      errors.push(`${rulePath}.id must be unique within the profile`);
    } else {
      seenRuleIds.add(rule["id"]);
    }
    if (!["allow", "deny", "approval_required"].includes(String(rule["action"]))) {
      errors.push(`${rulePath}.action must be allow, deny, or approval_required`);
    }
    validateNonEmptyStringArray(rule["tools"], `${rulePath}.tools`, errors, false);
    validateCapabilityArray(rule["capabilities"], `${rulePath}.capabilities`, errors);
    validateRuleMethodArray(rule["methods"], `${rulePath}.methods`, errors);
    validateRuleMatchers(rule as unknown as PolicyRule, rulePath, errors);
    validateRuleHasSelector(rule, rulePath, errors);
  }
}

function validateRuleMatchers(rule: PolicyRule, path: string, errors: string[]): void {
  if (rule.paths !== undefined) {
    if (!isRecord(rule.paths)) {
      errors.push(`${path}.paths must be an object`);
    } else {
      validateKnownProperties(rule.paths, `${path}.paths`, ["allowedRoots", "deniedRoots"], errors);
      validateNonEmptyStringArray(rule.paths["allowedRoots"], `${path}.paths.allowedRoots`, errors, false);
      validateNonEmptyStringArray(rule.paths["deniedRoots"], `${path}.paths.deniedRoots`, errors, false);
      if (rule.paths["allowedRoots"] === undefined && rule.paths["deniedRoots"] === undefined) {
        errors.push(`${path}.paths must include allowedRoots or deniedRoots`);
      }
    }
  }
  if (rule.commands !== undefined) {
    if (!Array.isArray(rule.commands)) {
      errors.push(`${path}.commands must be an array`);
    } else {
      if (rule.commands.length === 0) {
        errors.push(`${path}.commands must be a non-empty array`);
      }
      for (const [index, command] of rule.commands.entries()) {
        validateCommandRule(command, `${path}.commands[${index}]`, errors);
      }
    }
  }
  if (rule.networks !== undefined) {
    if (!Array.isArray(rule.networks)) {
      errors.push(`${path}.networks must be an array`);
    } else {
      if (rule.networks.length === 0) {
        errors.push(`${path}.networks must be a non-empty array`);
      }
      for (const [index, network] of rule.networks.entries()) {
        validateNetworkRule(network, `${path}.networks[${index}]`, errors);
      }
    }
  }
  if (rule.secrets !== undefined) {
    if (!isRecord(rule.secrets)) {
      errors.push(`${path}.secrets must be an object`);
    } else {
      validateKnownProperties(rule.secrets, `${path}.secrets`, ["labels"], errors);
      validateNonEmptyStringArray(rule.secrets["labels"], `${path}.secrets.labels`, errors, true);
    }
  }
}

function validateAudit(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateKnownProperties(value, path, ["destination", "path", "onFailure", "includeRawArguments", "includeFullPaths"], errors);
  if (!["file", "stdout"].includes(String(value["destination"]))) {
    errors.push(`${path}.destination must be file or stdout`);
  }
  if (!["fail_closed", "warn_and_continue"].includes(String(value["onFailure"]))) {
    errors.push(`${path}.onFailure must be fail_closed or warn_and_continue`);
  }
  if (value["includeRawArguments"] !== false) {
    errors.push(`${path}.includeRawArguments must be false`);
  }
  if (typeof value["includeFullPaths"] !== "boolean") {
    errors.push(`${path}.includeFullPaths must be boolean`);
  }
  if (value["destination"] === "file" && !isNonEmptyString(value["path"])) {
    errors.push(`${path}.path must be a non-empty string when destination is file`);
  }
  if (value["destination"] === "stdout" && value["path"] !== undefined) {
    errors.push(`${path}.path must be absent when destination is stdout`);
  }
}

function validateRedaction(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateKnownProperties(value, path, ["detectors"], errors);
  const detectors = value["detectors"];
  if (!Array.isArray(detectors)) {
    errors.push(`${path}.detectors must be an array`);
    return;
  }
  const seenDetectorIds = new Set<string>();
  for (const [index, detector] of detectors.entries()) {
    const detectorPath = `${path}.detectors[${index}]`;
    if (!isRecord(detector)) {
      errors.push(`${detectorPath} must be an object`);
      continue;
    }
    validateKnownProperties(detector, detectorPath, ["id", "kind", "replacement"], errors);
    if (!isNonEmptyString(detector["id"])) {
      errors.push(`${detectorPath}.id must be a non-empty string`);
    } else if (seenDetectorIds.has(detector["id"])) {
      errors.push(`${detectorPath}.id must be unique`);
    } else {
      seenDetectorIds.add(detector["id"]);
    }
    if (!["secret_like", "environment_value", "path", "prompt"].includes(String(detector["kind"]))) {
      errors.push(`${detectorPath}.kind is unsupported`);
    }
    if (typeof detector["replacement"] !== "string") {
      errors.push(`${detectorPath}.replacement must be a string`);
    }
  }
}

function validateRuleHasSelector(rule: Readonly<Record<string, unknown>>, path: string, errors: string[]): void {
  if (
    rule["tools"] === undefined &&
    rule["capabilities"] === undefined &&
    rule["methods"] === undefined &&
    rule["paths"] === undefined &&
    rule["commands"] === undefined &&
    rule["networks"] === undefined &&
    rule["secrets"] === undefined
  ) {
    errors.push(`${path} must include at least one selector or matcher`);
  }
}

function validateRuleMethodArray(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${path} must be an array of strings`);
    return;
  }
  if (value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
  }
  for (const method of value) {
    if (method !== "tools/call") {
      errors.push(`${path} contains unsupported method: ${method}`);
    }
  }
}

function validateCommandRule(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateKnownProperties(value, path, ["executable", "argv"], errors);
  if (!isNonEmptyString(value["executable"])) {
    errors.push(`${path}.executable must be a non-empty string`);
  }
  validateStringArray(value["argv"], `${path}.argv`, errors, false);
}

function validateNetworkRule(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  validateKnownProperties(value, path, ["domains", "ips"], errors);
  validateNonEmptyStringArray(value["domains"], `${path}.domains`, errors, false);
  validateNonEmptyStringArray(value["ips"], `${path}.ips`, errors, false);
  if (value["domains"] === undefined && value["ips"] === undefined) {
    errors.push(`${path} must include domains or ips`);
  }
}

function validateArgumentFact(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }

  const kind = value["kind"];
  if (!["path", "command", "network", "secret"].includes(String(kind))) {
    errors.push(`${path}.kind is unsupported`);
    return;
  }

  if (kind === "path" || kind === "network") {
    if (!isNonEmptyString(value["value"])) {
      errors.push(`${path}.value must be a non-empty string`);
    }
  }

  if (kind === "command") {
    if (!isNonEmptyString(value["executable"])) {
      errors.push(`${path}.executable must be a non-empty string`);
    }
    if (!Array.isArray(value["argv"]) || !value["argv"].every((item) => typeof item === "string")) {
      errors.push(`${path}.argv must be an array of strings`);
    }
  }

  if (kind === "secret" && !isNonEmptyString(value["label"])) {
    errors.push(`${path}.label must be a non-empty string`);
  }
}

function validateStringArray(value: unknown, path: string, errors: string[], required: boolean): void {
  if (value === undefined && !required) {
    return;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${path} must be an array of strings`);
  }
}

function validateNonEmptyStringArray(value: unknown, path: string, errors: string[], required: boolean): void {
  if (value === undefined && !required) {
    return;
  }
  validateStringArray(value, path, errors, required);
  if (Array.isArray(value) && value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
  }
}

function validateCapabilityArray(value: unknown, path: string, errors: string[]): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
  }
  for (const item of value) {
    if (typeof item !== "string" || !capabilities.has(item as Capability)) {
      errors.push(`${path} contains unsupported capability: ${String(item)}`);
    }
  }
}

function validateKnownProperties(
  value: Readonly<Record<string, unknown>>,
  path: string,
  allowedKeys: readonly string[],
  errors: string[]
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      errors.push(`${path} includes unsupported property: ${key}`);
    }
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function valid<T>(value: T): ValidationResult<T> {
  return { ok: true, value, errors: [] };
}

function invalid<T = never>(...errors: readonly string[]): ValidationResult<T> {
  return { ok: false, errors };
}
