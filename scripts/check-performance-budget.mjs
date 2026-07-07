import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { validatePolicyDocument } from "../packages/contracts/dist/index.js";
import {
  classifyToolDescriptor,
  createAuditEvent,
  evaluateMcpMethod,
  evaluateToolCall,
  redactText
} from "../packages/core/dist/index.js";

const policyText = readFileSync("fixtures/policies/local-dev.json", "utf8");
const policy = JSON.parse(policyText);
const call = JSON.parse(readFileSync("fixtures/mcp/call-file-read-denied.json", "utf8"));
const decision = evaluateToolCall({ policy, profileId: "local", call });

const checks = [
  measure("policy parse and validation", 100, 2000, () => {
    const parsed = JSON.parse(policyText);
    const result = validatePolicyDocument(parsed);
    if (!result.ok) {
      throw new Error("policy fixture failed validation during performance smoke");
    }
  }),
  measure("tool descriptor classification", 1000, 2000, () => {
    const result = classifyToolDescriptor({
      name: "read_file",
      description: "Read a caller-provided file path."
    });
    if (!result.descriptor.capabilities.includes("file-read")) {
      throw new Error("classifier smoke did not infer file-read");
    }
  }),
  measure("tool-call evaluation", 1000, 2000, () => {
    const result = evaluateToolCall({ policy, profileId: "local", call });
    if (result.action !== "deny") {
      throw new Error("evaluator smoke did not deny private file read");
    }
  }),
  measure("redaction summary generation", 1000, 2000, () => {
    const result = redactText("prefix REDACT_ME_VALUE_123 suffix");
    if (!result.summary.applied || result.value.includes("REDACT_ME_VALUE_123")) {
      throw new Error("redactor smoke did not redact marker");
    }
  }),
  measure("audit event formatting", 1000, 2000, () => {
    const event = createAuditEvent({
      kind: "call-decision",
      profileId: "local",
      toolName: "read_file",
      method: "tools/call",
      decision,
      redaction: {
        applied: false,
        counts: {}
      }
    });
    if (event.decision.action !== "deny") {
      throw new Error("audit smoke did not preserve decision");
    }
  }),
  measure("method dispatch", 1000, 2000, () => {
    const result = evaluateMcpMethod("resources/list", policy);
    if (result.action !== "deny") {
      throw new Error("method smoke did not deny unsupported method");
    }
  })
];

for (const check of checks) {
  console.log(`${check.name}: ${check.elapsedMs.toFixed(2)} ms for ${check.iterations} iterations`);
}

checkPerformanceBudgetValidator();

function measure(name, iterations, maxTotalMs, fn) {
  for (let index = 0; index < Math.min(iterations, 10); index += 1) {
    fn();
  }

  const start = performance.now();
  for (let index = 0; index < iterations; index += 1) {
    fn();
  }
  const elapsedMs = performance.now() - start;

  if (elapsedMs > maxTotalMs) {
    throw new Error(`${name} exceeded ${maxTotalMs} ms: ${elapsedMs.toFixed(2)} ms`);
  }

  return { name, iterations, elapsedMs };
}

function checkPerformanceBudgetValidator() {
  const validCheck = measure("<performance-self-test-valid>", 1, 1000, () => undefined);
  if (validCheck.name !== "<performance-self-test-valid>" || validCheck.iterations !== 1 || validCheck.elapsedMs < 0) {
    throw new Error("performance smoke self-test valid measure returned an invalid result");
  }

  const functionFailure = collectPerformanceFailure(() => {
    measure("<performance-self-test-function-failure>", 1, 1000, () => {
      throw new Error("synthetic function failure");
    });
  });
  if (!functionFailure.includes("synthetic function failure")) {
    throw new Error(`performance smoke self-test function failure was not propagated: ${functionFailure || "<none>"}`);
  }

  const budgetFailure = collectPerformanceFailure(() => {
    measure("<performance-self-test-budget-failure>", 1, -1, () => undefined);
  });
  if (!budgetFailure.includes("<performance-self-test-budget-failure> exceeded -1 ms")) {
    throw new Error(`performance smoke self-test budget failure was not rejected: ${budgetFailure || "<none>"}`);
  }
}

function collectPerformanceFailure(fn) {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}
