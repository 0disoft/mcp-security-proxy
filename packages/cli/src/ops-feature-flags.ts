import {
  createReloadableLocalProvider,
  loadFlagSnapshotFile,
  watchFlagSnapshotFile,
  type FlagSnapshotFileWatcher
} from "@0disoft/openfeature-local-provider";
import { ErrorCode, ProviderEvents, type EventDetails, type Logger } from "@openfeature/server-sdk";

export const OPS_METRICS_ENABLED_FLAG = "mcp.ops.metrics.enabled";

export type OpsFeatureFlagReloadFailure = "evaluation_failed" | "snapshot_reload_failed";

export interface OpsFeatureFlagControllerOptions {
  readonly path: string;
  readonly onConfigurationChanged?: (enabled: boolean) => void;
  readonly onReloadFailure?: (reason: OpsFeatureFlagReloadFailure) => void;
}

export interface OpsFeatureFlagController {
  isOpsMetricsEnabled(): boolean;
  close(): Promise<void>;
}

const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

export async function createOpsFeatureFlagController(
  options: OpsFeatureFlagControllerOptions
): Promise<OpsFeatureFlagController> {
  const snapshot = await loadFlagSnapshotFile(options.path);
  const provider = createReloadableLocalProvider({
    name: "mcp-security-proxy-ops",
    snapshot
  });
  let enabled = await resolveOpsMetricsEnabled(provider);
  let closed = false;
  let watcher: FlagSnapshotFileWatcher | undefined;
  let refreshQueue = Promise.resolve();

  const onConfigurationChanged = (details?: EventDetails): void => {
    const changedFlags = details?.flagsChanged;
    if (Array.isArray(changedFlags) && !changedFlags.includes(OPS_METRICS_ENABLED_FLAG)) {
      return;
    }
    refreshQueue = refreshQueue
      .then(async () => {
        if (closed) {
          return;
        }
        enabled = await resolveOpsMetricsEnabled(provider);
        options.onConfigurationChanged?.(enabled);
      })
      .catch(() => {
        options.onReloadFailure?.("evaluation_failed");
      });
  };

  provider.events?.addHandler(ProviderEvents.ConfigurationChanged, onConfigurationChanged);

  try {
    watcher = await watchFlagSnapshotFile({
      path: options.path,
      debounceMs: 50,
      consistencyPollIntervalMs: 100,
      persistent: false,
      onSnapshot(nextSnapshot) {
        provider.updateSnapshot(nextSnapshot);
      },
      onError() {
        options.onReloadFailure?.("snapshot_reload_failed");
      }
    });
  } catch (error) {
    provider.events?.removeHandler(ProviderEvents.ConfigurationChanged, onConfigurationChanged);
    await provider.onClose?.();
    throw error;
  }

  return {
    isOpsMetricsEnabled() {
      return enabled;
    },
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      watcher?.close();
      provider.events?.removeHandler(ProviderEvents.ConfigurationChanged, onConfigurationChanged);
      await refreshQueue;
      await provider.onClose?.();
    }
  };
}

async function resolveOpsMetricsEnabled(provider: ReturnType<typeof createReloadableLocalProvider>): Promise<boolean> {
  const details = await provider.resolveBooleanEvaluation(OPS_METRICS_ENABLED_FLAG, true, {}, logger);
  if (details.errorCode !== undefined && details.errorCode !== ErrorCode.FLAG_NOT_FOUND) {
    throw new Error("ops metrics feature flag evaluation failed");
  }
  return details.value;
}
