import { describe, expect, it } from "vitest";
import {
  runApprovalHookConformance,
  type ApprovalHookConformanceAdapter,
  type ApprovalHookConformanceScenario
} from "./approval-conformance.js";

describe("approval hook conformance", () => {
  it("passes a host adapter that handles explicit outcomes, abort, and concurrent identity", async () => {
    const report = await runApprovalHookConformance(compliantAdapter(), {
      abortAfterMs: 1,
      settleTimeoutMs: 25
    });

    expect(report).toEqual({
      schemaVersion: "msp.approval-hook-conformance.v1",
      passed: true,
      cases: [
        { id: "explicit-approval", passed: true, code: "approval_hook.approve_valid" },
        { id: "explicit-rejection", passed: true, code: "approval_hook.reject_valid" },
        { id: "hook-error", passed: true, code: "approval_hook.error_rejected" },
        { id: "abort-signal", passed: true, code: "approval_hook.abort_settled" },
        { id: "concurrent-isolation", passed: true, code: "approval_hook.concurrent_isolated" }
      ]
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.cases)).toBe(true);
  });

  it("reports invalid results and concurrent stale approvals without raw hook details", async () => {
    const rawMarker = "RAW_CONFORMANCE_HOOK_MARKER";
    const report = await runApprovalHookConformance(
      {
        createHook: (scenario) => {
          if (scenario === "error") {
            return () => {
              throw new Error(rawMarker);
            };
          }
          if (scenario === "abort") {
            return (request) =>
              new Promise((resolve) => {
                request.signal.addEventListener("abort", () => resolve({ approved: false }), { once: true });
              });
          }
          if (scenario === "concurrent") {
            return () => ({ approved: true, reason: rawMarker });
          }
          return () => ({ approved: scenario === "reject" ? ("no" as unknown as boolean) : true });
        }
      },
      { abortAfterMs: 1, settleTimeoutMs: 25 }
    );

    expect(report.passed).toBe(false);
    expect(report.cases).toEqual(
      expect.arrayContaining([
        { id: "explicit-rejection", passed: false, code: "approval_hook.unexpected_result" },
        { id: "concurrent-isolation", passed: false, code: "approval_hook.concurrent_mismatch" }
      ])
    );
    expect(JSON.stringify(report)).not.toContain(rawMarker);
  });

  it("fails an abort hook that ignores cancellation without retaining error details", async () => {
    const report = await runApprovalHookConformance(
      {
        createHook: (scenario) => {
          if (scenario === "abort") {
            return () => new Promise(() => undefined);
          }
          return createCompliantHook(scenario);
        }
      },
      { abortAfterMs: 1, settleTimeoutMs: 5 }
    );

    expect(report.cases).toContainEqual({
      id: "abort-signal",
      passed: false,
      code: "approval_hook.abort_not_settled"
    });
  });

  it("bounds adapters that never create or settle a non-abort scenario", async () => {
    const setupReport = await runApprovalHookConformance(
      {
        createHook: (scenario) =>
          scenario === "approve" ? new Promise(() => undefined) : createCompliantHook(scenario)
      },
      { abortAfterMs: 1, settleTimeoutMs: 5 }
    );
    const settlementReport = await runApprovalHookConformance(
      {
        createHook: (scenario) =>
          scenario === "concurrent" ? () => new Promise(() => undefined) : createCompliantHook(scenario)
      },
      { abortAfterMs: 1, settleTimeoutMs: 5 }
    );

    expect(setupReport.cases).toContainEqual({
      id: "explicit-approval",
      passed: false,
      code: "approval_hook.adapter_setup_failed"
    });
    expect(settlementReport.cases).toContainEqual({
      id: "concurrent-isolation",
      passed: false,
      code: "approval_hook.not_settled"
    });
  });
});

function compliantAdapter(): ApprovalHookConformanceAdapter {
  return {
    createHook: createCompliantHook
  };
}

function createCompliantHook(scenario: ApprovalHookConformanceScenario) {
  if (scenario === "approve") {
    return () => ({ approved: true });
  }
  if (scenario === "reject") {
    return () => ({ approved: false, reason: "host-owned synthetic rejection" });
  }
  if (scenario === "error") {
    return () => {
      throw new Error("host-owned synthetic failure");
    };
  }
  if (scenario === "abort") {
    return (request: Parameters<import("./session.js").ApprovalHook>[0]) =>
      new Promise<import("./session.js").ApprovalResult>((resolve) => {
        request.signal.addEventListener("abort", () => resolve({ approved: false }), { once: true });
      });
  }
  return (request: Parameters<import("./session.js").ApprovalHook>[0]) => ({
    approved: request.approvalId.endsWith("-approve")
  });
}
