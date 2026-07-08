import { describe, expect, it } from "vitest";
import { createDenyByDefaultPolicy, parsePolicyDocumentJson, validatePolicyDocument } from "./index.js";

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

  it("rejects unknown policy properties to match the closed JSON schema contract", () => {
    const policy = createDenyByDefaultPolicy("local");
    const result = validatePolicyDocument({
      ...policy,
      unexpectedTop: true,
      methodPolicy: {
        ...policy.methodPolicy,
        unexpectedMethod: true
      },
      profiles: [
        {
          ...policy.profiles[0],
          unexpectedProfile: true,
          audit: {
            ...policy.profiles[0]?.audit,
            unexpectedAudit: true
          },
          rules: [
            {
              id: "allow-public-files",
              action: "allow",
              capabilities: ["file-read"],
              unexpectedRule: true,
              paths: {
                allowedRoots: ["workspace/public"],
                unexpectedPath: true
              }
            },
            {
              id: "allow-command",
              action: "allow",
              capabilities: ["shell"],
              commands: [
                {
                  executable: "node",
                  unexpectedCommand: true
                }
              ]
            },
            {
              id: "allow-network",
              action: "allow",
              capabilities: ["network"],
              networks: [
                {
                  domains: ["example.com"],
                  unexpectedNetwork: true
                }
              ]
            },
            {
              id: "allow-secret",
              action: "allow",
              capabilities: ["secret"],
              secrets: {
                labels: ["api-key"],
                unexpectedSecret: true
              }
            }
          ]
        }
      ],
      redaction: {
        detectors: [
          {
            id: "synthetic-redaction-marker",
            kind: "secret_like",
            replacement: "[REDACTED_VALUE]",
            unexpectedDetector: true
          }
        ],
        unexpectedRedaction: true
      }
    });

    expect(result).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        "policy includes unsupported property: unexpectedTop",
        "methodPolicy includes unsupported property: unexpectedMethod",
        "profiles[0] includes unsupported property: unexpectedProfile",
        "profiles[0].audit includes unsupported property: unexpectedAudit",
        "profiles[0].rules[0] includes unsupported property: unexpectedRule",
        "profiles[0].rules[0].paths includes unsupported property: unexpectedPath",
        "profiles[0].rules[1].commands[0] includes unsupported property: unexpectedCommand",
        "profiles[0].rules[2].networks[0] includes unsupported property: unexpectedNetwork",
        "profiles[0].rules[3].secrets includes unsupported property: unexpectedSecret",
        "redaction includes unsupported property: unexpectedRedaction",
        "redaction.detectors[0] includes unsupported property: unexpectedDetector"
      ])
    });
  });
});
