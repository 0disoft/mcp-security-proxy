import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const targets = [
  {
    document: "agent-plugin/plugin.json",
    schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"
  },
  {
    document: "agent-plugin/mcp.json",
    schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json"
  }
];
const ajv = new Ajv2020({ allErrors: true, strict: true });

for (const target of targets) {
  const schema = await fetchSchema(target.schema);
  const validate = ajv.compile(schema);
  const document = JSON.parse(readFileSync(join(root, target.document), "utf8"));
  if (!validate(document)) {
    console.error(`${target.document}: failed live validation against ${target.schema}`);
    console.error(ajv.errorsText(validate.errors, { separator: "\n" }));
    process.exitCode = 1;
  }
}

async function fetchSchema(url) {
  const response = await fetch(url, {
    headers: { accept: "application/schema+json, application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    throw new Error(`${url}: official schema request failed with HTTP ${response.status}`);
  }
  const body = await response.text();
  if (body.length > 128 * 1024) {
    throw new Error(`${url}: official schema exceeds the 128 KiB validation limit`);
  }
  const schema = JSON.parse(body);
  if (schema.$id !== url) {
    throw new Error(`${url}: official schema returned an unexpected $id`);
  }
  return schema;
}
