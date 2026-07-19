import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PolicyDocument } from "@0disoft/mcp-security-proxy-contracts";
import type { PolicyReloadUpdate } from "@0disoft/mcp-security-proxy-runtime";
import { createPolicyFileReloadSource } from "./policy-file-reloader.js";

const repoRoot = resolve(import.meta.dirname, "../../..");

afterEach(() => {
  vi.useRealTimers();
});

describe("policy file reloader", () => {
  it("ignores the unchanged startup snapshot and emits one debounced valid replacement", async () => {
    vi.useFakeTimers();
    const initialPolicy = readPolicy();
    let text = JSON.stringify(initialPolicy);
    const watcher = new FakeWatcher();
    const updates: PolicyReloadUpdate[] = [];
    const source = createPolicyFileReloadSource(
      {
        policyPath: "policy.json",
        profileId: "local",
        initialPolicy,
        readTextFile: () => text
      },
      {
        debounceMs: 5,
        watchDirectory: fakeWatchDirectory(watcher)
      }
    );
    const unsubscribe = source.subscribe((update) => {
      updates.push(update);
    });

    await vi.advanceTimersByTimeAsync(5);
    expect(updates).toEqual([]);

    text = JSON.stringify(withAdditionalDenyRule(initialPolicy));
    watcher.emit("change", "change", "policy.json");
    watcher.emit("change", "rename", "policy.json");
    await vi.advanceTimersByTimeAsync(5);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "accepted" });
    unsubscribe();
    expect(watcher.closed).toBe(true);
  });

  it("rejects invalid, missing-profile, and audit-changing candidates without raw details", async () => {
    vi.useFakeTimers();
    const initialPolicy = readPolicy();
    let text = JSON.stringify(initialPolicy);
    const watcher = new FakeWatcher();
    const updates: PolicyReloadUpdate[] = [];
    const diagnostics: PolicyReloadUpdate[] = [];
    const source = createPolicyFileReloadSource(
      {
        policyPath: "policy.json",
        profileId: "local",
        initialPolicy,
        readTextFile: () => text,
        onResult: (update) => diagnostics.push(update)
      },
      {
        debounceMs: 1,
        watchDirectory: fakeWatchDirectory(watcher)
      }
    );
    source.subscribe((update) => {
      updates.push(update);
    });
    await vi.advanceTimersByTimeAsync(1);

    text = '{"raw":"PRIVATE_POLICY_MARKER"';
    watcher.emit("change", "change", "policy.json");
    await vi.advanceTimersByTimeAsync(1);
    watcher.emit("change", "change", "policy.json");
    await vi.advanceTimersByTimeAsync(1);

    const missingProfile = withAdditionalDenyRule(initialPolicy);
    text = JSON.stringify({
      ...missingProfile,
      profiles: missingProfile.profiles.map((profile) => ({ ...profile, id: "other" }))
    });
    watcher.emit("change", "rename", "policy.json");
    await vi.advanceTimersByTimeAsync(1);

    text = JSON.stringify({
      ...missingProfile,
      profiles: missingProfile.profiles.map((profile) =>
        profile.id === "local" ? { ...profile, audit: { ...profile.audit, onFailure: "warn_and_continue" } } : profile
      )
    });
    watcher.emit("change", "change", "policy.json");
    await vi.advanceTimersByTimeAsync(1);

    expect(updates).toEqual([
      { status: "rejected", reasonCode: "invalid_policy" },
      { status: "rejected", reasonCode: "profile_missing" },
      { status: "rejected", reasonCode: "audit_changed" }
    ]);
    expect(diagnostics).toEqual(updates);
    expect(JSON.stringify(updates)).not.toContain("PRIVATE_POLICY_MARKER");
  });

  it("reports read and watcher failures with stable codes", async () => {
    vi.useFakeTimers();
    const initialPolicy = readPolicy();
    const watcher = new FakeWatcher();
    const updates: PolicyReloadUpdate[] = [];
    const source = createPolicyFileReloadSource(
      {
        policyPath: "policy.json",
        profileId: "local",
        initialPolicy,
        readTextFile: () => {
          throw new Error("PRIVATE_READ_FAILURE");
        }
      },
      {
        debounceMs: 1,
        watchDirectory: fakeWatchDirectory(watcher)
      }
    );
    source.subscribe((update) => {
      updates.push(update);
    });

    await vi.advanceTimersByTimeAsync(1);
    watcher.emit("change", "change", "policy.json");
    await vi.advanceTimersByTimeAsync(1);
    watcher.emit("error", new Error("PRIVATE_WATCH_FAILURE"));
    watcher.emit("error", new Error("PRIVATE_WATCH_FAILURE_AGAIN"));

    expect(updates).toEqual([
      { status: "rejected", reasonCode: "read_failed" },
      { status: "rejected", reasonCode: "watch_failed" }
    ]);
    expect(JSON.stringify(updates)).not.toContain("PRIVATE");
    expect(watcher.closed).toBe(true);
  });
});

class FakeWatcher extends EventEmitter {
  closed = false;

  close(): void {
    this.closed = true;
  }
}

function fakeWatchDirectory(watcher: FakeWatcher): typeof import("node:fs").watch {
  return ((_path: string, _options: unknown, listener: (...args: unknown[]) => void) => {
    watcher.on("change", listener);
    return watcher;
  }) as unknown as typeof import("node:fs").watch;
}

function readPolicy(): PolicyDocument {
  return JSON.parse(readFileSync(resolve(repoRoot, "fixtures/policies/local-dev.json"), "utf8")) as PolicyDocument;
}

function withAdditionalDenyRule(policy: PolicyDocument): PolicyDocument {
  return {
    ...policy,
    profiles: policy.profiles.map((profile) =>
      profile.id === "local"
        ? {
            ...profile,
            rules: [
              ...profile.rules,
              {
                id: "reload-deny-browser",
                action: "deny",
                capabilities: ["browser"]
              }
            ]
          }
        : profile
    )
  };
}
