import { isSupportedByokProviderId } from "../lib/byok-providers.js";
import { logger } from "../lib/logger.js";
import { isManagedCloudModelId } from "../lib/managed-models.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

export interface QuotaFallbackResult {
  success: boolean;
  newModelId?: string;
}

export interface ByokProviderInfo {
  providerId: string;
  modelId: string;
}

export class QuotaFallbackService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly syncService: OpenClawSyncService,
  ) {}

  private isManagedModelId(
    modelId: string,
    config: Awaited<ReturnType<NexuConfigStore["getConfig"]>>,
  ): boolean {
    const desktopConfig = config.desktop as {
      cloud?: { models?: Array<{ id: string }> };
    };
    return isManagedCloudModelId(modelId, desktopConfig.cloud?.models ?? []);
  }

  // Returns true when the current default model is a Nexu-managed (cloud) model.
  async isUsingManagedModel(): Promise<boolean> {
    const config = await this.configStore.getConfig();
    return this.isManagedModelId(config.runtime.defaultModelId, config);
  }

  // Returns the first enabled BYOK provider that has an API key and at least one model.
  async getAvailableByokProvider(): Promise<ByokProviderInfo | null> {
    const config = await this.configStore.getConfig();
    for (const provider of config.providers) {
      if (!provider.enabled) {
        continue;
      }
      if (!isSupportedByokProviderId(provider.providerId)) {
        continue;
      }
      // OAuth providers (no apiKey) are excluded from auto-fallback.
      if (!provider.apiKey) {
        continue;
      }
      const firstModel = provider.models[0];
      if (!firstModel) {
        continue;
      }
      return {
        providerId: provider.providerId,
        modelId: `${provider.providerId}/${firstModel}`,
      };
    }
    return null;
  }

  // Switches the default model to the given BYOK provider and syncs OpenClaw.
  async triggerFallback(): Promise<QuotaFallbackResult> {
    const byok = await this.getAvailableByokProvider();
    if (!byok) {
      logger.warn({}, "quota_fallback_no_byok_provider_available");
      return { success: false };
    }

    const config = await this.configStore.getConfig();
    const previousModelId = config.runtime.defaultModelId;

    await this.configStore.setDefaultModel(byok.modelId);
    await this.syncService.syncAll();

    logger.info(
      {
        previous: previousModelId,
        next: byok.modelId,
        provider: byok.providerId,
      },
      "quota_fallback_triggered",
    );

    return { success: true, newModelId: byok.modelId };
  }

  // Restores the default model to a managed (cloud) model if one is available.
  // Expects callers to pass the target managed model ID.
  async restoreManaged(managedModelId: string): Promise<QuotaFallbackResult> {
    const config = await this.configStore.getConfig();
    if (!this.isManagedModelId(managedModelId, config)) {
      logger.warn(
        { managedModelId },
        "quota_fallback_restore_rejected_non_managed_model",
      );
      return { success: false };
    }

    const previousModelId = config.runtime.defaultModelId;

    await this.configStore.setDefaultModel(managedModelId);
    await this.syncService.syncAll();

    logger.info(
      { previous: previousModelId, next: managedModelId },
      "quota_fallback_restored_managed",
    );

    return { success: true, newModelId: managedModelId };
  }
}
