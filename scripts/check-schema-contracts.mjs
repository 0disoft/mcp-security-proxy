import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIT_DESTINATIONS,
  AUDIT_EVENT_KINDS,
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_FAILURE_ACTIONS,
  CAPABILITIES,
  DECISION_REASON_CODES,
  DECISION_SCHEMA_VERSION,
  MVP_ALLOWED_METHODS,
  POLICY_ACTIONS,
  POLICY_SCHEMA_VERSION,
  REDACTION_DETECTOR_KINDS
} from "../packages/contracts/dist/index.js";

const root = process.cwd();
const failures = [];

const policySchema = readJson("packages/contracts/schemas/policy.v1.schema.json");
const decisionSchema = readJson("packages/contracts/schemas/decision.v1.schema.json");
const auditSchema = readJson("packages/contracts/schemas/audit-event.v1.schema.json");

assertEqual("policy.schemaVersion", policySchema.properties?.schemaVersion?.const, POLICY_SCHEMA_VERSION);
assertArrayEqual(
  "policy.methodPolicy.allowedMethods",
  policySchema.properties?.methodPolicy?.properties?.allowedMethods?.items?.enum,
  MVP_ALLOWED_METHODS
);
assertArrayEqual("policy.rule.action", policySchema.$defs?.rule?.properties?.action?.enum, POLICY_ACTIONS);
assertArrayEqual("policy.rule.capabilities", policySchema.$defs?.rule?.properties?.capabilities?.items?.enum, CAPABILITIES);
assertArrayEqual("policy.audit.destination", policySchema.$defs?.auditPolicy?.properties?.destination?.enum, AUDIT_DESTINATIONS);
assertArrayEqual("policy.audit.onFailure", policySchema.$defs?.auditPolicy?.properties?.onFailure?.enum, AUDIT_FAILURE_ACTIONS);
assertArrayEqual(
  "policy.redaction.kind",
  policySchema.$defs?.redactionDetector?.properties?.kind?.enum,
  REDACTION_DETECTOR_KINDS
);

assertEqual("decision.schemaVersion", decisionSchema.properties?.schemaVersion?.const, DECISION_SCHEMA_VERSION);
assertArrayEqual("decision.action", decisionSchema.properties?.action?.enum, POLICY_ACTIONS);
assertArrayEqual(
  "decision.evidence.code",
  decisionSchema.properties?.evidence?.items?.properties?.code?.enum,
  DECISION_REASON_CODES
);

assertEqual("audit.schemaVersion", auditSchema.properties?.schemaVersion?.const, AUDIT_EVENT_SCHEMA_VERSION);
assertArrayEqual("audit.kind", auditSchema.properties?.kind?.enum, AUDIT_EVENT_KINDS);

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
