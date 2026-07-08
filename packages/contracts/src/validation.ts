import {
  AUDIT_DESTINATIONS,
  AUDIT_FAILURE_ACTIONS,
  CAPABILITIES,
  MVP_ALLOWED_METHODS,
  POLICY_ACTIONS,
  POLICY_SCHEMA_VERSION,
  REDACTION_DETECTOR_KINDS,
  type Capability,
  type AuditPolicy,
  type CommandRule,
  type MethodPolicy,
  type NetworkRule,
  type PathRule,
  type PolicyDocument,
  type PolicyRule,
  type RedactionDetector,
  type RedactionPolicy,
  type SecretRule,
  type ServerProfile
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

const capabilities = new Set<string>(CAPABILITIES);
const policyActions = new Set<string>(POLICY_ACTIONS);
const allowedMcpMethods = new Set<string>(MVP_ALLOWED_METHODS);
const auditDestinations = new Set<string>(AUDIT_DESTINATIONS);
const auditFailureActions = new Set<string>(AUDIT_FAILURE_ACTIONS);
const redactionDetectorKinds = new Set<string>(REDACTION_DETECTOR_KINDS);

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

  const methodPolicy = parseMethodPolicy(value["methodPolicy"], errors);

  const profiles = parseProfiles(value["profiles"], errors);
  const redaction = parseRedaction(value["redaction"], "redaction", errors);

  if (errors.length > 0 || !methodPolicy || !profiles) {
    return invalid(...errors);
  }
  const document: PolicyDocument = {
    schemaVersion: POLICY_SCHEMA_VERSION,
    defaultAction: "deny",
    methodPolicy,
    profiles,
    ...(redaction ? { redaction } : {})
  };
  return valid(document);
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

  const valueCapabilities = parseCapabilityArray(value["capabilities"], "capabilities", errors, true);

  const argumentFacts = parseArgumentFacts(value["argumentFacts"], errors);

  if (errors.length > 0 || !isNonEmptyString(value["toolName"]) || !valueCapabilities || !argumentFacts) {
    return invalid(...errors);
  }
  return valid({
    method: "tools/call",
    toolName: value["toolName"],
    capabilities: valueCapabilities,
    argumentFacts
  });
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

  if (errors.length > 0 || !Array.isArray(tools)) {
    return invalid(...errors);
  }
  return valid({
    tools: tools.map((tool) => ({
      name: isRecord(tool) && isNonEmptyString(tool["name"]) ? tool["name"] : "",
      ...(isRecord(tool) && typeof tool["description"] === "string" ? { description: tool["description"] } : {})
    }))
  });
}

export function knownSchemaVersions(): readonly string[] {
  return [POLICY_SCHEMA_VERSION, DECISION_SCHEMA_VERSION, AUDIT_EVENT_SCHEMA_VERSION];
}

function parseMethodPolicy(value: unknown, errors: string[]): MethodPolicy | undefined {
  if (!isRecord(value)) {
    errors.push("methodPolicy must be an object");
    return undefined;
  }

  validateKnownProperties(value, "methodPolicy", ["allowedMethods", "denyUnsupported"], errors);
  const allowedMethods = value["allowedMethods"];
  let parsedAllowedMethods: string[] | undefined;
  if (!Array.isArray(allowedMethods) || allowedMethods.length === 0) {
    errors.push("methodPolicy.allowedMethods must be a non-empty array");
  } else {
    parsedAllowedMethods = [];
    const seenMethods = new Set<string>();
    for (const method of allowedMethods) {
      if (typeof method !== "string" || !allowedMcpMethods.has(method)) {
        errors.push(`unsupported method in methodPolicy.allowedMethods: ${String(method)}`);
        continue;
      }
      if (seenMethods.has(method)) {
        errors.push(`duplicate method in methodPolicy.allowedMethods: ${method}`);
      }
      seenMethods.add(method);
      parsedAllowedMethods.push(method);
    }
  }
  if (value["denyUnsupported"] !== true) {
    errors.push("methodPolicy.denyUnsupported must be true");
  }

  return parsedAllowedMethods
    ? {
        allowedMethods: parsedAllowedMethods,
        denyUnsupported: true
      }
    : undefined;
}

function parseProfiles(value: unknown, errors: string[]): readonly ServerProfile[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push("profiles must be a non-empty array");
    return undefined;
  }

  const profiles: ServerProfile[] = [];
  const seenProfileIds = new Set<string>();
  for (const [profileIndex, profile] of value.entries()) {
    const parsed = parseProfile(profile, profileIndex, seenProfileIds, errors);
    if (parsed) {
      profiles.push(parsed);
    }
  }
  return profiles;
}

function parseProfile(value: unknown, profileIndex: number, seenProfileIds: Set<string>, errors: string[]): ServerProfile | undefined {
  const path = `profiles[${profileIndex}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }

  validateKnownProperties(value, path, ["id", "defaultAction", "rules", "audit"], errors);
  const id = value["id"];
  if (!isNonEmptyString(id)) {
    errors.push(`${path}.id must be a non-empty string`);
  } else if (seenProfileIds.has(id)) {
    errors.push(`duplicate profile id: ${id}`);
  } else {
    seenProfileIds.add(id);
  }
  if (value["defaultAction"] !== "deny") {
    errors.push(`${path}.defaultAction must be deny`);
  }
  const rules = parseRules(value["rules"], `${path}.rules`, errors);
  const audit = parseAudit(value["audit"], `${path}.audit`, errors);

  return isNonEmptyString(id) && rules && audit
    ? {
        id,
        defaultAction: "deny",
        rules,
        audit
      }
    : undefined;
}

function parseRules(value: unknown, path: string, errors: string[]): readonly PolicyRule[] | undefined {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return undefined;
  }

  const rules: PolicyRule[] = [];
  const seenRuleIds = new Set<string>();
  for (const [index, rule] of value.entries()) {
    const parsed = parsePolicyRule(rule, `${path}[${index}]`, seenRuleIds, errors);
    if (parsed) {
      rules.push(parsed);
    }
  }
  return rules;
}

function parsePolicyRule(value: unknown, path: string, seenRuleIds: Set<string>, errors: string[]): PolicyRule | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  validateKnownProperties(
    value,
    path,
    ["id", "action", "tools", "capabilities", "methods", "paths", "commands", "networks", "secrets"],
    errors
  );

  const id = value["id"];
  if (!isNonEmptyString(id)) {
    errors.push(`${path}.id must be a non-empty string`);
  } else if (seenRuleIds.has(id)) {
    errors.push(`${path}.id must be unique within the profile`);
  } else {
    seenRuleIds.add(id);
  }

  const action = value["action"];
  if (!isPolicyAction(action)) {
    errors.push(`${path}.action must be allow, deny, or approval_required`);
  }

  const tools = parseNonEmptyStringArray(value["tools"], `${path}.tools`, errors, false);
  const ruleCapabilities = parseCapabilityArray(value["capabilities"], `${path}.capabilities`, errors, false);
  const methods = parseRuleMethodArray(value["methods"], `${path}.methods`, errors);
  const paths = parsePathRule(value["paths"], `${path}.paths`, errors);
  const commands = parseCommandRules(value["commands"], `${path}.commands`, errors);
  const networks = parseNetworkRules(value["networks"], `${path}.networks`, errors);
  const secrets = parseSecretRule(value["secrets"], `${path}.secrets`, errors);
  validateRuleHasSelector(value, path, errors);

  return isNonEmptyString(id) && isPolicyAction(action)
    ? {
        id,
        action,
        ...(tools ? { tools } : {}),
        ...(ruleCapabilities ? { capabilities: ruleCapabilities } : {}),
        ...(methods ? { methods } : {}),
        ...(paths ? { paths } : {}),
        ...(commands ? { commands } : {}),
        ...(networks ? { networks } : {}),
        ...(secrets ? { secrets } : {})
      }
    : undefined;
}

function parsePathRule(value: unknown, path: string, errors: string[]): PathRule | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }

  validateKnownProperties(value, path, ["allowedRoots", "deniedRoots"], errors);
  const allowedRoots = parseNonEmptyStringArray(value["allowedRoots"], `${path}.allowedRoots`, errors, false);
  const deniedRoots = parseNonEmptyStringArray(value["deniedRoots"], `${path}.deniedRoots`, errors, false);
  validateCanonicalPathRootArray(value["allowedRoots"], `${path}.allowedRoots`, errors);
  validateCanonicalPathRootArray(value["deniedRoots"], `${path}.deniedRoots`, errors);
  if (value["allowedRoots"] === undefined && value["deniedRoots"] === undefined) {
    errors.push(`${path} must include allowedRoots or deniedRoots`);
  }

  return {
    ...(allowedRoots ? { allowedRoots } : {}),
    ...(deniedRoots ? { deniedRoots } : {})
  };
}

function parseCommandRules(value: unknown, path: string, errors: string[]): readonly CommandRule[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return undefined;
  }
  if (value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
  }

  const commands: CommandRule[] = [];
  for (const [index, command] of value.entries()) {
    const parsed = parseCommandRule(command, `${path}[${index}]`, errors);
    if (parsed) {
      commands.push(parsed);
    }
  }
  return commands;
}

function parseCommandRule(value: unknown, path: string, errors: string[]): CommandRule | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  validateKnownProperties(value, path, ["executable", "argv"], errors);
  if (!isNonEmptyString(value["executable"])) {
    errors.push(`${path}.executable must be a non-empty string`);
  }
  const argv = parseStringArray(value["argv"], `${path}.argv`, errors, false);
  return isNonEmptyString(value["executable"])
    ? {
        executable: value["executable"],
        ...(argv ? { argv } : {})
      }
    : undefined;
}

function parseNetworkRules(value: unknown, path: string, errors: string[]): readonly NetworkRule[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return undefined;
  }
  if (value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
  }

  const networks: NetworkRule[] = [];
  for (const [index, network] of value.entries()) {
    const parsed = parseNetworkRule(network, `${path}[${index}]`, errors);
    if (parsed) {
      networks.push(parsed);
    }
  }
  return networks;
}

function parseNetworkRule(value: unknown, path: string, errors: string[]): NetworkRule | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  validateKnownProperties(value, path, ["domains", "ips"], errors);
  const domains = parseNonEmptyStringArray(value["domains"], `${path}.domains`, errors, false);
  const ips = parseNonEmptyStringArray(value["ips"], `${path}.ips`, errors, false);
  validateCanonicalDomainArray(value["domains"], `${path}.domains`, errors);
  validateCanonicalIpArray(value["ips"], `${path}.ips`, errors);
  if (value["domains"] === undefined && value["ips"] === undefined) {
    errors.push(`${path} must include domains or ips`);
  }

  return {
    ...(domains ? { domains } : {}),
    ...(ips ? { ips } : {})
  };
}

function parseSecretRule(value: unknown, path: string, errors: string[]): SecretRule | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  validateKnownProperties(value, path, ["labels"], errors);
  const labels = parseNonEmptyStringArray(value["labels"], `${path}.labels`, errors, true);
  return labels ? { labels } : undefined;
}

function parseAudit(value: unknown, path: string, errors: string[]): AuditPolicy | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  validateKnownProperties(value, path, ["destination", "path", "onFailure", "includeRawArguments", "includeFullPaths"], errors);
  if (!isAuditDestination(value["destination"])) {
    errors.push(`${path}.destination must be file or stdout`);
  }
  if (!isAuditFailureAction(value["onFailure"])) {
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

  return isAuditDestination(value["destination"]) &&
    isAuditFailureAction(value["onFailure"]) &&
    value["includeRawArguments"] === false &&
    typeof value["includeFullPaths"] === "boolean"
    ? {
        destination: value["destination"],
        ...(isNonEmptyString(value["path"]) ? { path: value["path"] } : {}),
        onFailure: value["onFailure"],
        includeRawArguments: false,
        includeFullPaths: value["includeFullPaths"]
      }
    : undefined;
}

function parseRedaction(value: unknown, path: string, errors: string[]): RedactionPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  validateKnownProperties(value, path, ["detectors"], errors);
  const detectors = value["detectors"];
  if (!Array.isArray(detectors)) {
    errors.push(`${path}.detectors must be an array`);
    return undefined;
  }
  const parsedDetectors: RedactionDetector[] = [];
  const seenDetectorIds = new Set<string>();
  for (const [index, detector] of detectors.entries()) {
    const parsed = parseRedactionDetector(detector, `${path}.detectors[${index}]`, seenDetectorIds, errors);
    if (parsed) {
      parsedDetectors.push(parsed);
    }
  }
  return { detectors: parsedDetectors };
}

function parseRedactionDetector(
  value: unknown,
  path: string,
  seenDetectorIds: Set<string>,
  errors: string[]
): RedactionDetector | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  validateKnownProperties(value, path, ["id", "kind", "replacement"], errors);
  if (!isNonEmptyString(value["id"])) {
    errors.push(`${path}.id must be a non-empty string`);
  } else if (seenDetectorIds.has(value["id"])) {
    errors.push(`${path}.id must be unique`);
  } else {
    seenDetectorIds.add(value["id"]);
  }
  if (!isRedactionDetectorKind(value["kind"])) {
    errors.push(`${path}.kind is unsupported`);
  }
  if (typeof value["replacement"] !== "string") {
    errors.push(`${path}.replacement must be a string`);
  }

  return isNonEmptyString(value["id"]) && isRedactionDetectorKind(value["kind"]) && typeof value["replacement"] === "string"
    ? {
        id: value["id"],
        kind: value["kind"],
        replacement: value["replacement"]
      }
    : undefined;
}

function parseCapabilityArray(value: unknown, path: string, errors: string[], required: boolean): readonly Capability[] | undefined {
  if (value === undefined && !required) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    errors.push(required ? `${path} must be a non-empty array` : `${path} must be an array`);
    return undefined;
  }
  if (value.length === 0) {
    errors.push(path === "capabilities" ? "capabilities must be a non-empty array" : `${path} must be a non-empty array`);
  }

  const parsed: Capability[] = [];
  for (const item of value) {
    if (!isCapability(item)) {
      errors.push(path === "capabilities" ? `unsupported capability: ${String(item)}` : `${path} contains unsupported capability: ${String(item)}`);
      continue;
    }
    parsed.push(item);
  }
  return parsed;
}

function parseArgumentFacts(value: unknown, errors: string[]): readonly ArgumentFact[] | undefined {
  if (!Array.isArray(value)) {
    errors.push("argumentFacts must be an array");
    return undefined;
  }

  const facts: ArgumentFact[] = [];
  for (const [index, fact] of value.entries()) {
    const parsed = parseArgumentFact(fact, `argumentFacts[${index}]`, errors);
    if (parsed) {
      facts.push(parsed);
    }
  }
  return facts;
}

function parseArgumentFact(value: unknown, path: string, errors: string[]): ArgumentFact | undefined {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }

  const kind = value["kind"];
  if (!["path", "command", "network", "secret"].includes(String(kind))) {
    errors.push(`${path}.kind is unsupported`);
    return undefined;
  }

  if (kind === "path" || kind === "network") {
    if (!isNonEmptyString(value["value"])) {
      errors.push(`${path}.value must be a non-empty string`);
      return undefined;
    }
    return { kind, value: value["value"] };
  }

  if (kind === "command") {
    if (!isNonEmptyString(value["executable"])) {
      errors.push(`${path}.executable must be a non-empty string`);
    }
    const argv = parseStringArray(value["argv"], `${path}.argv`, errors, true);
    return isNonEmptyString(value["executable"]) && argv ? { kind, executable: value["executable"], argv } : undefined;
  }

  if (kind === "secret") {
    if (!isNonEmptyString(value["label"])) {
      errors.push(`${path}.label must be a non-empty string`);
      return undefined;
    }
    return { kind, label: value["label"] };
  }
  return undefined;
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

function parseRuleMethodArray(value: unknown, path: string, errors: string[]): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${path} must be an array of strings`);
    return undefined;
  }
  if (value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
  }
  for (const method of value) {
    if (method !== "tools/call") {
      errors.push(`${path} contains unsupported method: ${method}`);
    }
  }
  return value;
}

function validateCanonicalPathRootArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item === "string" && !isCanonicalPathRoot(item)) {
      errors.push(`${path}[${index}] must be a canonical path root`);
    }
  }
}

function validateCanonicalDomainArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item === "string" && !isCanonicalDomain(item)) {
      errors.push(`${path}[${index}] must be a canonical network domain`);
    }
  }
}

function validateCanonicalIpArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const [index, item] of value.entries()) {
    if (typeof item === "string" && !isCanonicalIp(item)) {
      errors.push(`${path}[${index}] must be a canonical network ip`);
    }
  }
}

function isCanonicalPathRoot(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.includes("\0") &&
    trimmed === trimmed.normalize("NFC") &&
    !/^[/\\]{2}/u.test(trimmed) &&
    !/^~(?:$|[/\\])/u.test(trimmed) &&
    !/%2f|%5c/i.test(trimmed) &&
    !trimmed.split(/[\\/]+/u).includes("..")
  );
}

function isCanonicalDomain(value: string): boolean {
  if (value.length === 0 || value !== value.trim() || /\s/u.test(value) || value.includes("://")) {
    return false;
  }

  try {
    const parsed = new URL(`msp://${value}`);
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.port.length === 0 &&
      (parsed.pathname === "" || parsed.pathname === "/") &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0 &&
      host.length > 0 &&
      host === value.toLowerCase() &&
      !isCanonicalIp(host)
    );
  } catch {
    return false;
  }
}

function isCanonicalIp(value: string): boolean {
  if (value.length === 0 || value !== value.trim() || /\s/u.test(value) || /[@/\\?#]/u.test(value)) {
    return false;
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) {
    return value.split(".").every((octet) => Number(octet) <= 255);
  }
  if (!value.includes(":")) {
    return false;
  }

  try {
    const parsed = new URL(`msp://[${value}]`);
    return parsed.hostname.toLowerCase() === `[${value.toLowerCase()}]`;
  } catch {
    return false;
  }
}

function parseStringArray(value: unknown, path: string, errors: string[], required: boolean): readonly string[] | undefined {
  if (value === undefined && !required) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${path} must be an array of strings`);
    return undefined;
  }
  return value;
}

function parseNonEmptyStringArray(value: unknown, path: string, errors: string[], required: boolean): readonly string[] | undefined {
  if (value === undefined && !required) {
    return undefined;
  }
  const parsed = parseStringArray(value, path, errors, required);
  if (parsed && parsed.length === 0) {
    errors.push(`${path} must be a non-empty array`);
  }
  return parsed;
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

function isPolicyAction(value: unknown): value is PolicyRule["action"] {
  return typeof value === "string" && policyActions.has(value);
}

function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && capabilities.has(value);
}

function isAuditDestination(value: unknown): value is AuditPolicy["destination"] {
  return typeof value === "string" && auditDestinations.has(value);
}

function isAuditFailureAction(value: unknown): value is AuditPolicy["onFailure"] {
  return typeof value === "string" && auditFailureActions.has(value);
}

function isRedactionDetectorKind(value: unknown): value is RedactionDetector["kind"] {
  return typeof value === "string" && redactionDetectorKinds.has(value);
}

function valid<T>(value: T): ValidationResult<T> {
  return { ok: true, value, errors: [] };
}

function invalid<T = never>(...errors: readonly string[]): ValidationResult<T> {
  return { ok: false, errors };
}
