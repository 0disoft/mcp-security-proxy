import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIT_DESTINATIONS,
  AUDIT_CORRELATION_VERSION,
  AUDIT_DIRECTIONS,
  AUDIT_EVENT_KINDS,
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_FAILURE_ACTIONS,
  CAPABILITIES,
  DECISION_REASON_CODES,
  DECISION_SCHEMA_VERSION,
  MVP_ALLOWED_METHODS,
  JSON_RPC_ID_TYPES,
  OPS_EVENT_KINDS,
  OPS_EVENT_SCHEMA_VERSION,
  OPS_LIFECYCLE_EVENTS,
  POLICY_ACTIONS,
  POLICY_SCHEMA_VERSION,
  REDACTION_DETECTOR_KINDS
} from "../packages/contracts/dist/index.js";

const root = process.cwd();
const failures = [];
const expectedSchemaFiles = [
  "audit-event.v1.schema.json",
  "decision.v1.schema.json",
  "ops-event.v1.schema.json",
  "policy.v1.schema.json"
];

assertArrayEqual(
  "packages/contracts/schemas files",
  readdirSync(join(root, "packages", "contracts", "schemas"))
    .filter((name) => name.endsWith(".schema.json"))
    .sort((left, right) => left.localeCompare(right)),
  expectedSchemaFiles
);

const policySchema = readJson("packages/contracts/schemas/policy.v1.schema.json");
const decisionSchema = readJson("packages/contracts/schemas/decision.v1.schema.json");
const auditSchema = readJson("packages/contracts/schemas/audit-event.v1.schema.json");
const opsSchema = readJson("packages/contracts/schemas/ops-event.v1.schema.json");

assertEqual("policy.schemaVersion", policySchema.properties?.schemaVersion?.const, POLICY_SCHEMA_VERSION);
assertArrayEqual(
  "policy.methodPolicy.allowedMethods",
  policySchema.properties?.methodPolicy?.properties?.allowedMethods?.items?.enum,
  MVP_ALLOWED_METHODS
);
assertArrayEqual("policy.rule.action", policySchema.$defs?.rule?.properties?.action?.enum, POLICY_ACTIONS);
assertArrayEqual(
  "policy.rule.capabilities",
  policySchema.$defs?.rule?.properties?.capabilities?.items?.enum,
  CAPABILITIES
);
assertArrayEqual(
  "policy.audit.destination",
  policySchema.$defs?.auditPolicy?.properties?.destination?.enum,
  AUDIT_DESTINATIONS
);
assertArrayEqual(
  "policy.audit.onFailure",
  policySchema.$defs?.auditPolicy?.properties?.onFailure?.enum,
  AUDIT_FAILURE_ACTIONS
);
assertArrayEqual(
  "policy.redaction.kind",
  policySchema.$defs?.redactionDetector?.properties?.kind?.enum,
  REDACTION_DETECTOR_KINDS
);

assertEqual("decision.schemaVersion", decisionSchema.properties?.schemaVersion?.const, DECISION_SCHEMA_VERSION);
assertArrayEqual("decision.action", decisionSchema.properties?.action?.enum, POLICY_ACTIONS);
assertArrayEqual("decision.evidence.required", decisionSchema.properties?.evidence?.items?.required, [
  "code",
  "reason"
]);
assertArrayEqual(
  "decision.evidence.code",
  decisionSchema.properties?.evidence?.items?.properties?.code?.enum,
  DECISION_REASON_CODES
);

assertEqual("audit.schemaVersion", auditSchema.properties?.schemaVersion?.const, AUDIT_EVENT_SCHEMA_VERSION);
assertArrayEqual("audit.kind", auditSchema.properties?.kind?.enum, AUDIT_EVENT_KINDS);
assertEqual(
  "audit.correlation.version",
  auditSchema.$defs?.correlation?.properties?.correlationVersion?.const,
  AUDIT_CORRELATION_VERSION
);
assertArrayEqual(
  "audit.correlation.direction",
  auditSchema.$defs?.correlation?.properties?.direction?.enum,
  AUDIT_DIRECTIONS
);
assertArrayEqual(
  "audit.correlation.jsonRpcIdType",
  auditSchema.$defs?.correlation?.properties?.jsonRpcIdType?.enum,
  JSON_RPC_ID_TYPES
);

assertEqual("ops.schemaVersion", opsSchema.$defs?.base?.properties?.schemaVersion?.const, OPS_EVENT_SCHEMA_VERSION);
assertArrayEqual("ops.kind", opsSchema.$defs?.base?.properties?.kind?.enum, OPS_EVENT_KINDS);
assertArrayEqual("ops.lifecycle.event", opsSchema.$defs?.base?.properties?.event?.enum, OPS_LIFECYCLE_EVENTS);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertArrayEqual(label, actual, expected) {
  const actualArray = Array.isArray(actual) ? actual : [];
  const expectedArray = [...expected];
  const actualText = JSON.stringify(actualArray);
  const expectedText = JSON.stringify(expectedArray);
  if (actualText !== expectedText) {
    failures.push(`${label}: expected ${expectedText}, got ${actualText}`);
  }
}
