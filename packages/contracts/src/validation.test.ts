import { describe, expect, it } from "vitest";
import { createDenyByDefaultPolicy, parsePolicyDocumentJson } from "./index.js";

describe("policy document parsing", () => {
  it("parses and validates policy JSON text through the public contracts surface", () => {
    const result = parsePolicyDocumentJson(JSON.stringify(createDenyByDefaultPolicy("local")));

    expect(result).toMatchObject({
      ok: true,
      value: {
        schemaVersion: "msp.policy.v1",
        profiles: [{ id: "local" }]
      }
    });
  });

  it("rejects malformed policy JSON without echoing source text", () => {
    const result = parsePolicyDocumentJson('{"schemaVersion":"RAW_POLICY_SECRET_MARKER"');

    expect(result).toEqual({
      ok: false,
      errors: ["policy JSON is invalid"]
    });
    expect(JSON.stringify(result)).not.toContain("RAW_POLICY_SECRET_MARKER");
  });

  it("returns schema validation errors after JSON parsing succeeds", () => {
    const result = parsePolicyDocumentJson("{}");

    expect(result).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        "schemaVersion must be msp.policy.v1",
        "defaultAction must be deny",
        "methodPolicy must be an object",
        "profiles must be a non-empty array"
      ])
    });
  });
});
