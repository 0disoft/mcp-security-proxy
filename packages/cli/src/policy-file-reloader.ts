import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { parsePolicyDocumentJson, type AuditPolicy, type PolicyDocument } from "@0disoft/mcp-security-proxy-contracts";
import type { PolicyReloadSource, PolicyReloadUpdate } from "@0disoft/mcp-security-proxy-runtime";

export interface PolicyFileReloadOptions {
  readonly policyPath: string;
  readonly profileId: string;
  readonly initialPolicy: PolicyDocument;
  readonly readTextFile: (path: string) => string;
  readonly onResult?: (update: PolicyReloadUpdate) => void;
}

interface PolicyFileReloadDependencies {
  readonly debounceMs?: number;
  readonly watchDirectory?: typeof watch;
}

const defaultDebounceMs = 100;

export function createPolicyFileReloadSource(
  options: PolicyFileReloadOptions,
  dependencies: PolicyFileReloadDependencies = {}
): PolicyReloadSource {
  const absolutePath = resolve(options.policyPath);
  const directory = dirname(absolutePath);
  const targetName = basename(absolutePath);
  const initialProfile = options.initialPolicy.profiles.find((profile) => profile.id === options.profileId);
  if (!initialProfile) {
    throw new TypeError("policy reload requires the active profile in the initial policy");
  }
  const initialAudit = initialProfile.audit;
  let lastAttemptFingerprint = fingerprintPolicy(options.initialPolicy);

  return {
    subscribe(listener) {
      let closed = false;
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      let watcher: FSWatcher | undefined;
      let readFailureReported = false;
      let watchFailureReported = false;

      const reportResult = (update: PolicyReloadUpdate): void => {
        try {
          options.onResult?.(update);
        } catch {
          // Diagnostics are advisory and cannot change policy state or watcher lifetime.
        }
      };
      const emit = async (update: PolicyReloadUpdate): Promise<void> => {
        if (closed) {
          return;
        }
        try {
          await listener(update);
          if (!closed) {
            reportResult(update);
          }
        } catch {
          if (!closed) {
            reportResult({ status: "rejected", reasonCode: "runtime_validation_failed" });
          }
        }
      };
      const reject = async (
        reasonCode: Extract<PolicyReloadUpdate, { status: "rejected" }>["reasonCode"]
      ): Promise<void> => {
        await emit({ status: "rejected", reasonCode });
      };
      const reload = async (): Promise<void> => {
        debounceTimer = undefined;
        if (closed) {
          return;
        }
        let text: string;
        try {
          text = options.readTextFile(absolutePath);
        } catch {
          if (!readFailureReported) {
            readFailureReported = true;
            await reject("read_failed");
          }
          return;
        }
        readFailureReported = false;
        const rawFingerprint = createHash("sha256").update(text).digest("hex");
        const validation = parsePolicyDocumentJson(text);
        if (!validation.ok) {
          const invalidFingerprint = `invalid:${rawFingerprint}`;
          if (invalidFingerprint === lastAttemptFingerprint) {
            return;
          }
          lastAttemptFingerprint = invalidFingerprint;
          await reject("invalid_policy");
          return;
        }
        const policyFingerprint = fingerprintPolicy(validation.value);
        if (policyFingerprint === lastAttemptFingerprint) {
          return;
        }
        lastAttemptFingerprint = policyFingerprint;
        const profile = validation.value.profiles.find((item) => item.id === options.profileId);
        if (!profile) {
          await reject("profile_missing");
          return;
        }
        if (!auditPoliciesEqual(initialAudit, profile.audit)) {
          await reject("audit_changed");
          return;
        }
        await emit({ status: "accepted", policy: validation.value });
      };
      const scheduleReload = (): void => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => void reload(), dependencies.debounceMs ?? defaultDebounceMs);
        debounceTimer.unref?.();
      };
      const onDirectoryChange = (_eventType: string, filename: string | Buffer | null): void => {
        if (filename !== null && !sameFilename(filename.toString(), targetName)) {
          return;
        }
        scheduleReload();
      };

      try {
        watcher = (dependencies.watchDirectory ?? watch)(directory, { persistent: false }, onDirectoryChange);
        watcher.on("error", () => {
          if (watchFailureReported || closed) {
            return;
          }
          watchFailureReported = true;
          if (debounceTimer) {
            clearTimeout(debounceTimer);
            debounceTimer = undefined;
          }
          watcher?.close();
          void reject("watch_failed");
        });
        scheduleReload();
      } catch {
        watchFailureReported = true;
        void reject("watch_failed");
      }

      return () => {
        if (closed) {
          return;
        }
        closed = true;
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        watcher?.close();
      };
    }
  };
}

function fingerprintPolicy(policy: PolicyDocument): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeJson(policy)))
    .digest("hex");
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeJson(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, canonicalizeJson(item)])
    );
  }
  return value;
}

function sameFilename(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function auditPoliciesEqual(left: AuditPolicy, right: AuditPolicy): boolean {
  return (
    left.destination === right.destination &&
    left.path === right.path &&
    left.onFailure === right.onFailure &&
    left.includeRawArguments === right.includeRawArguments &&
    left.includeFullPaths === right.includeFullPaths
  );
}
