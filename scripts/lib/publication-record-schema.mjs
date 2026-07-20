import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const publicationRecordSchemaPaths = Object.freeze({
  "msp.publication-record.v1": "docs/ops/publications/schemas/publication-record.v1.schema.json",
  "msp.publication-record.v2": "docs/ops/publications/schemas/publication-record.v2.schema.json"
});

export function createPublicationRecordSchemaValidator(root = process.cwd()) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validators = new Map(
    Object.entries(publicationRecordSchemaPaths).map(([version, path]) => [
      version,
      ajv.compile(JSON.parse(readFileSync(join(root, path), "utf8")))
    ])
  );

  return (record) => {
    const schemaVersion = record?.schemaVersion;
    const validate = validators.get(schemaVersion);
    if (!validate) {
      return {
        valid: false,
        errors: [`unsupported schemaVersion ${JSON.stringify(schemaVersion)}`]
      };
    }
    if (validate(record)) {
      return { valid: true, errors: [] };
    }
    return {
      valid: false,
      errors: (validate.errors ?? []).map(
        (error) => `${error.instancePath || "/"} ${error.message ?? "failed validation"}`
      )
    };
  };
}
