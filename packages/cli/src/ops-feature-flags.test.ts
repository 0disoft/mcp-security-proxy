import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createOpsFeatureFlagController,
  OPS_METRICS_ENABLED_FLAG,
  type OpsFeatureFlagReloadFailure
} from "./ops-feature-flags.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("ops feature flag controller", () => {
  it("applies configuration-change events and retains the last valid snapshot", async () => {
    const directory = await createTemporaryDirectory();
    const flagsPath = join(directory, "flags.json");
    const changes: boolean[] = [];
    const failures: OpsFeatureFlagReloadFailure[] = [];
    await writeSnapshot(flagsPath, false);

    const controller = await createOpsFeatureFlagController({
      path: flagsPath,
      onConfigurationChanged: (enabled) => changes.push(enabled),
      onReloadFailure: (reason) => failures.push(reason)
    });

    try {
      expect(controller.isOpsMetricsEnabled()).toBe(false);

      await replaceSnapshot(flagsPath, true);
      await waitFor(() => controller.isOpsMetricsEnabled(), "enabled configuration change");
      expect(changes).toEqual([true]);

      await replaceText(flagsPath, '{"schemaVersion":1,"flags":');
      await waitFor(() => failures.includes("snapshot_reload_failed"), "invalid snapshot rejection");
      expect(controller.isOpsMetricsEnabled()).toBe(true);
      expect(changes).toEqual([true]);

      await replaceText(flagsPath, `${JSON.stringify(createStringSnapshot(), null, 2)}\n`);
      await waitFor(() => failures.includes("evaluation_failed"), "invalid flag type rejection");
      expect(controller.isOpsMetricsEnabled()).toBe(true);
      expect(changes).toEqual([true]);
    } finally {
      await controller.close();
    }
  });

  it("rejects an invalid initial flag type", async () => {
    const directory = await createTemporaryDirectory();
    const flagsPath = join(directory, "flags.json");
    await writeFile(flagsPath, `${JSON.stringify(createStringSnapshot(), null, 2)}\n`, "utf8");

    await expect(createOpsFeatureFlagController({ path: flagsPath })).rejects.toThrow(
      "ops metrics feature flag evaluation failed"
    );
  });

  it("stops observing changes after close", async () => {
    const directory = await createTemporaryDirectory();
    const flagsPath = join(directory, "flags.json");
    const changes: boolean[] = [];
    await writeSnapshot(flagsPath, false);
    const controller = await createOpsFeatureFlagController({
      path: flagsPath,
      onConfigurationChanged: (enabled) => changes.push(enabled)
    });

    await controller.close();
    await replaceSnapshot(flagsPath, true);
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(controller.isOpsMetricsEnabled()).toBe(false);
    expect(changes).toEqual([]);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mcp-security-proxy-ops-flags-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeSnapshot(path: string, enabled: boolean): Promise<void> {
  await writeFile(path, `${JSON.stringify(createSnapshot(enabled), null, 2)}\n`, "utf8");
}

async function replaceSnapshot(path: string, enabled: boolean): Promise<void> {
  await replaceText(path, `${JSON.stringify(createSnapshot(enabled), null, 2)}\n`);
}

async function replaceText(path: string, text: string): Promise<void> {
  const stagingPath = join(
    temporaryDirectories.at(-1) ?? tmpdir(),
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`
  );
  await writeFile(stagingPath, text, "utf8");
  await rename(stagingPath, path);
}

function createSnapshot(enabled: boolean): object {
  return {
    schemaVersion: 1,
    flags: {
      [OPS_METRICS_ENABLED_FLAG]: {
        type: "boolean",
        defaultVariant: enabled ? "enabled" : "disabled",
        variants: {
          disabled: false,
          enabled: true
        }
      }
    }
  };
}

function createStringSnapshot(): object {
  return {
    schemaVersion: 1,
    flags: {
      [OPS_METRICS_ENABLED_FLAG]: {
        type: "string",
        defaultVariant: "enabled",
        variants: {
          enabled: "yes"
        }
      }
    }
  };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${label}`);
}
