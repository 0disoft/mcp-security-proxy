import type { NormalizedToolCall, PolicyDecision } from "@0disoft/mcp-security-proxy-contracts";
import type { ApprovalHook, ApprovalRequest, ApprovalResult } from "./session.js";

export type ApprovalHookConformanceScenario = "approve" | "reject" | "error" | "abort" | "concurrent";

export type ApprovalHookConformanceCaseId =
  "explicit-approval" | "explicit-rejection" | "hook-error" | "abort-signal" | "concurrent-isolation";

export type ApprovalHookConformanceCode =
  | "approval_hook.approve_valid"
  | "approval_hook.reject_valid"
  | "approval_hook.error_rejected"
  | "approval_hook.abort_settled"
  | "approval_hook.concurrent_isolated"
  | "approval_hook.adapter_setup_failed"
  | "approval_hook.not_settled"
  | "approval_hook.unexpected_result"
  | "approval_hook.unexpected_error"
  | "approval_hook.abort_settled_early"
  | "approval_hook.abort_not_settled"
  | "approval_hook.abort_approved"
  | "approval_hook.concurrent_mismatch";

export interface ApprovalHookConformanceAdapter {
  readonly createHook: (scenario: ApprovalHookConformanceScenario) => ApprovalHook | Promise<ApprovalHook>;
}

export interface ApprovalHookConformanceOptions {
  readonly abortAfterMs?: number;
  readonly settleTimeoutMs?: number;
}

export interface ApprovalHookConformanceCaseResult {
  readonly id: ApprovalHookConformanceCaseId;
  readonly passed: boolean;
  readonly code: ApprovalHookConformanceCode;
}

export interface ApprovalHookConformanceReport {
  readonly schemaVersion: "msp.approval-hook-conformance.v1";
  readonly passed: boolean;
  readonly cases: readonly ApprovalHookConformanceCaseResult[];
}

interface ObservedHookResult {
  readonly status: "fulfilled" | "rejected" | "timed_out";
  readonly value?: unknown;
}

const defaultAbortAfterMs = 5;
const defaultSettleTimeoutMs = 1_000;
const maximumConformanceTimeoutMs = 30_000;

export async function runApprovalHookConformance(
  adapter: ApprovalHookConformanceAdapter,
  options: ApprovalHookConformanceOptions = {}
): Promise<ApprovalHookConformanceReport> {
  if (!adapter || typeof adapter.createHook !== "function") {
    throw new TypeError("approval hook conformance requires an adapter createHook function");
  }
  const abortAfterMs = resolveBoundedTimeout(options.abortAfterMs, defaultAbortAfterMs, "abortAfterMs");
  const settleTimeoutMs = resolveBoundedTimeout(options.settleTimeoutMs, defaultSettleTimeoutMs, "settleTimeoutMs");
  const cases = [
    await checkExpectedResult(
      adapter,
      "approve",
      true,
      "explicit-approval",
      "approval_hook.approve_valid",
      settleTimeoutMs
    ),
    await checkExpectedResult(
      adapter,
      "reject",
      false,
      "explicit-rejection",
      "approval_hook.reject_valid",
      settleTimeoutMs
    ),
    await checkExpectedError(adapter, settleTimeoutMs),
    await checkAbort(adapter, abortAfterMs, settleTimeoutMs),
    await checkConcurrentIsolation(adapter, settleTimeoutMs)
  ];
  return deepFreeze({
    schemaVersion: "msp.approval-hook-conformance.v1",
    passed: cases.every((item) => item.passed),
    cases
  });
}

async function checkExpectedResult(
  adapter: ApprovalHookConformanceAdapter,
  scenario: "approve" | "reject",
  expected: boolean,
  id: ApprovalHookConformanceCaseId,
  passCode: ApprovalHookConformanceCode,
  settleTimeoutMs: number
): Promise<ApprovalHookConformanceCaseResult> {
  const hook = await createScenarioHook(adapter, scenario, settleTimeoutMs);
  if (!hook) {
    return result(id, false, "approval_hook.adapter_setup_failed");
  }
  const controller = new AbortController();
  try {
    const observed = await observeHookWithin(
      hook,
      createRequest(`approval-conformance-${scenario}`, controller.signal),
      settleTimeoutMs
    );
    if (observed.status === "timed_out") {
      return result(id, false, "approval_hook.not_settled");
    }
    if (observed.status !== "fulfilled") {
      return result(id, false, "approval_hook.unexpected_error");
    }
    if (!isApprovalResult(observed.value) || observed.value.approved !== expected) {
      return result(id, false, "approval_hook.unexpected_result");
    }
    return result(id, true, passCode);
  } finally {
    controller.abort();
  }
}

async function checkExpectedError(
  adapter: ApprovalHookConformanceAdapter,
  settleTimeoutMs: number
): Promise<ApprovalHookConformanceCaseResult> {
  const id = "hook-error";
  const hook = await createScenarioHook(adapter, "error", settleTimeoutMs);
  if (!hook) {
    return result(id, false, "approval_hook.adapter_setup_failed");
  }
  const controller = new AbortController();
  try {
    const observed = await observeHookWithin(
      hook,
      createRequest("approval-conformance-error", controller.signal),
      settleTimeoutMs
    );
    if (observed.status === "timed_out") {
      return result(id, false, "approval_hook.not_settled");
    }
    return observed.status === "rejected"
      ? result(id, true, "approval_hook.error_rejected")
      : result(id, false, "approval_hook.unexpected_result");
  } finally {
    controller.abort();
  }
}

async function checkAbort(
  adapter: ApprovalHookConformanceAdapter,
  abortAfterMs: number,
  settleTimeoutMs: number
): Promise<ApprovalHookConformanceCaseResult> {
  const id = "abort-signal";
  const hook = await createScenarioHook(adapter, "abort", settleTimeoutMs);
  if (!hook) {
    return result(id, false, "approval_hook.adapter_setup_failed");
  }
  const controller = new AbortController();
  let settled = false;
  const observedPromise = observeHook(hook, createRequest("approval-conformance-abort", controller.signal)).then(
    (observed) => {
      settled = true;
      return observed;
    }
  );
  await delay(abortAfterMs);
  if (settled) {
    controller.abort();
    return result(id, false, "approval_hook.abort_settled_early");
  }
  controller.abort();
  const observed = await settleWithin(observedPromise, settleTimeoutMs);
  if (!observed) {
    return result(id, false, "approval_hook.abort_not_settled");
  }
  if (observed.status === "fulfilled") {
    if (!isApprovalResult(observed.value) || observed.value.approved) {
      return result(id, false, "approval_hook.abort_approved");
    }
  }
  return result(id, true, "approval_hook.abort_settled");
}

async function checkConcurrentIsolation(
  adapter: ApprovalHookConformanceAdapter,
  settleTimeoutMs: number
): Promise<ApprovalHookConformanceCaseResult> {
  const id = "concurrent-isolation";
  const hook = await createScenarioHook(adapter, "concurrent", settleTimeoutMs);
  if (!hook) {
    return result(id, false, "approval_hook.adapter_setup_failed");
  }
  const approvedController = new AbortController();
  const rejectedController = new AbortController();
  try {
    const [approved, rejected] = await Promise.all([
      observeHookWithin(
        hook,
        createRequest("approval-conformance-concurrent-approve", approvedController.signal),
        settleTimeoutMs
      ),
      observeHookWithin(
        hook,
        createRequest("approval-conformance-concurrent-reject", rejectedController.signal),
        settleTimeoutMs
      )
    ]);
    if (approved.status === "timed_out" || rejected.status === "timed_out") {
      return result(id, false, "approval_hook.not_settled");
    }
    if (
      approved.status !== "fulfilled" ||
      rejected.status !== "fulfilled" ||
      !isApprovalResult(approved.value) ||
      !isApprovalResult(rejected.value) ||
      !approved.value.approved ||
      rejected.value.approved
    ) {
      return result(id, false, "approval_hook.concurrent_mismatch");
    }
    return result(id, true, "approval_hook.concurrent_isolated");
  } finally {
    approvedController.abort();
    rejectedController.abort();
  }
}

async function createScenarioHook(
  adapter: ApprovalHookConformanceAdapter,
  scenario: ApprovalHookConformanceScenario,
  settleTimeoutMs: number
): Promise<ApprovalHook | undefined> {
  try {
    const hook = await settleWithin(
      Promise.resolve().then(() => adapter.createHook(scenario)),
      settleTimeoutMs
    );
    return typeof hook === "function" ? hook : undefined;
  } catch {
    return undefined;
  }
}

async function observeHook(hook: ApprovalHook, request: ApprovalRequest): Promise<ObservedHookResult> {
  try {
    return { status: "fulfilled", value: await hook(request) };
  } catch {
    return { status: "rejected" };
  }
}

async function observeHookWithin(
  hook: ApprovalHook,
  request: ApprovalRequest,
  settleTimeoutMs: number
): Promise<ObservedHookResult> {
  return (await settleWithin(observeHook(hook, request), settleTimeoutMs)) ?? { status: "timed_out" };
}

function createRequest(approvalId: string, signal: AbortSignal): ApprovalRequest {
  const call: NormalizedToolCall = deepFreeze({
    toolName: "approval_conformance_tool",
    method: "tools/call",
    capabilities: ["workflow"],
    argumentFacts: []
  });
  const decision: PolicyDecision = deepFreeze({
    schemaVersion: "msp.decision.v1",
    action: "approval_required",
    evidence: [
      {
        code: "policy.rule_approval_required",
        ruleId: "approval-conformance-rule",
        capability: "workflow",
        reason: "matched approval-required conformance rule"
      }
    ]
  });
  return Object.freeze({
    approvalId,
    profileId: "approval-conformance-profile",
    call,
    decision,
    signal
  });
}

function isApprovalResult(value: unknown): value is ApprovalResult {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).approved === "boolean" &&
    ((value as Record<string, unknown>).reason === undefined ||
      typeof (value as Record<string, unknown>).reason === "string")
  );
}

function result(
  id: ApprovalHookConformanceCaseId,
  passed: boolean,
  code: ApprovalHookConformanceCode
): ApprovalHookConformanceCaseResult {
  return Object.freeze({ id, passed, code });
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function resolveBoundedTimeout(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximumConformanceTimeoutMs) {
    throw new RangeError(`${label} must be an integer from 1 to ${maximumConformanceTimeoutMs}`);
  }
  return resolved;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
