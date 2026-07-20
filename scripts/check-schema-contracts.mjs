import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
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
  OPS_POLICY_EVENTS,
  POLICY_RELOAD_REJECTION_CODES,
  POLICY_ACTIONS,
  POLICY_SCHEMA_VERSION,
  REDACTION_DETECTOR_KINDS
} from "../packages/contracts/dist/index.js";
import {
  createPublicationRecordSchemaValidator,
  publicationRecordSchemaPaths
} from "./lib/publication-record-schema.mjs";

const root = process.cwd();
const failures = [];
const expectedSchemaFiles = [
  "audit-event.v1.schema.json",
  "decision.v1.schema.json",
  "ops-event.v1.schema.json",
  "policy.v1.schema.json"
];
const expectedPublicationSchemaFiles = Object.values(publicationRecordSchemaPaths)
  .map((path) => basename(path))
  .sort((left, right) => left.localeCompare(right));

assertArrayEqual(
  "packages/contracts/schemas files",
  readdirSync(join(root, "packages", "contracts", "schemas"))
    .filter((name) => name.endsWith(".schema.json"))
    .sort((left, right) => left.localeCompare(right)),
  expectedSchemaFiles
);
assertArrayEqual(
  "docs/ops/publications/schemas files",
  readdirSync(join(root, "docs", "ops", "publications", "schemas"))
    .filter((name) => name.endsWith(".schema.json"))
    .sort((left, right) => left.localeCompare(right)),
  expectedPublicationSchemaFiles
);

const policySchema = readJson("packages/contracts/schemas/policy.v1.schema.json");
const decisionSchema = readJson("packages/contracts/schemas/decision.v1.schema.json");
const auditSchema = readJson("packages/contracts/schemas/audit-event.v1.schema.json");
const opsSchema = readJson("packages/contracts/schemas/ops-event.v1.schema.json");
const publicationV1Schema = readJson(publicationRecordSchemaPaths["msp.publication-record.v1"]);
const publicationV2Schema = readJson(publicationRecordSchemaPaths["msp.publication-record.v2"]);

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
assertArrayEqual("ops.event", opsSchema.$defs?.base?.properties?.event?.enum, [
  ...OPS_LIFECYCLE_EVENTS,
  ...OPS_POLICY_EVENTS
]);
assertArrayEqual(
  "ops.policy.reload_rejected.reasonCode",
  opsSchema.$defs?.policyReloadRejected?.allOf?.[1]?.properties?.reasonCode?.enum,
  POLICY_RELOAD_REJECTION_CODES
);

assertEqual("publication.v1.$schema", publicationV1Schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assertEqual(
  "publication.v1.schemaVersion",
  publicationV1Schema.properties?.schemaVersion?.const,
  "msp.publication-record.v1"
);
assertEqual("publication.v1.githubRelease", publicationV1Schema.properties?.githubRelease, undefined);
assertEqual("publication.v1.additionalProperties", publicationV1Schema.additionalProperties, false);
assertEqual("publication.v2.$schema", publicationV2Schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assertEqual(
  "publication.v2.schemaVersion",
  publicationV2Schema.properties?.schemaVersion?.const,
  "msp.publication-record.v2"
);
assertArrayEqual(
  "publication.v2.required githubRelease",
  publicationV2Schema.required?.filter((item) => item === "githubRelease"),
  ["githubRelease"]
);
assertEqual(
  "publication.v2.githubRelease.draft",
  publicationV2Schema.$defs?.githubRelease?.properties?.draft?.const,
  false
);
assertEqual("publication.v2.additionalProperties", publicationV2Schema.additionalProperties, false);

const validatePublicationRecordShape = createPublicationRecordSchemaValidator(root);
const publicationV1Fixture = readJson("fixtures/publications/publication-record.v1.valid.json");
const publicationV2Fixture = readJson("fixtures/publications/publication-record.v2.valid.json");
assertSchemaValid("publication v1 fixture", publicationV1Fixture);
assertSchemaValid("publication v2 fixture", publicationV2Fixture);

const v1WithV2Evidence = structuredClone(publicationV1Fixture);
v1WithV2Evidence.githubRelease = structuredClone(publicationV2Fixture.githubRelease);
assertSchemaInvalid("publication v1 fixture with v2 evidence", v1WithV2Evidence);

const v2WithoutGitHubRelease = structuredClone(publicationV2Fixture);
delete v2WithoutGitHubRelease.githubRelease;
assertSchemaInvalid("publication v2 fixture without GitHub Release evidence", v2WithoutGitHubRelease);

const v2WithUnknownField = structuredClone(publicationV2Fixture);
v2WithUnknownField.untrackedEvidence = true;
assertSchemaInvalid("publication v2 fixture with an unknown field", v2WithUnknownField);

const v2WithInvalidTag = structuredClone(publicationV2Fixture);
v2WithInvalidTag.tag = "v0..2";
assertSchemaInvalid("publication v2 fixture with an invalid SemVer tag", v2WithInvalidTag);

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

function assertSchemaValid(label, value) {
  const result = validatePublicationRecordShape(value);
  if (!result.valid) {
    failures.push(`${label}: expected valid, got ${result.errors.join("; ")}`);
  }
}

function assertSchemaInvalid(label, value) {
  const result = validatePublicationRecordShape(value);
  if (result.valid) {
    failures.push(`${label}: expected JSON Schema rejection`);
  }
}
