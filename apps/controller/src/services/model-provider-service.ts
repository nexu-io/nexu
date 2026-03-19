import type {
  Model,
  verifyProviderBodySchema,
  verifyProviderResponseSchema,
} from "@nexu/shared";
import type { z } from "zod";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

const PROVIDER_BASE_URLS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
  siliconflow: "https://api.siliconflow.com/v1",
  ppio: "https://api.ppinfra.com/v3/openai",
  openrouter: "https://openrouter.ai/api/v1",
  minimax: "https://api.minimaxi.com/anthropic",
  kimi: "https://api.moonshot.cn/v1",
  glm: "https://open.bigmodel.cn/api/paas/v4",
  moonshot: "https://api.moonshot.cn/v1",
  zai: "https://open.bigmodel.cn/api/paas/v4",
};

function buildProviderUrl(
  baseUrl: string | null | undefined,
  path: string,
): string | null {
  if (!baseUrl || baseUrl.trim().length === 0) {
    return null;
  }

  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

type VerifyProviderBody = z.infer<typeof verifyProviderBodySchema>;
type VerifyProviderResponse = z.infer<typeof verifyProviderResponseSchema>;

export class ModelProviderService {
  constructor(private readonly configStore: NexuConfigStore) {}

  async listModels() {
    const config = await this.configStore.getConfig();
    const desktopCloud = await this.configStore.getDesktopCloudStatus();
    const cloudModels: Model[] = (desktopCloud.models ?? []).map((model) => ({
      id: model.id,
      name: model.name || model.id,
      provider: "nexu",
      description: "Cloud model via Nexu Link",
    }));

    const providers = config.providers.filter((provider) => provider.enabled);
    const byokModels: Model[] = providers.flatMap((provider) =>
      provider.models.map((modelId) => ({
        id: `${provider.providerId}/${modelId}`,
        name: modelId,
        provider: provider.providerId,
      })),
    );

    return {
      models: [...cloudModels, ...byokModels],
    };
  }

  async listProviders() {
    return {
      providers: await this.configStore.listProviders(),
    };
  }

  async upsertProvider(
    providerId: string,
    input: Parameters<NexuConfigStore["upsertProvider"]>[1],
  ) {
    return this.configStore.upsertProvider(providerId, input);
  }

  async deleteProvider(providerId: string) {
    return this.configStore.deleteProvider(providerId);
  }

  async verifyProvider(
    providerId: string,
    input: VerifyProviderBody,
  ): Promise<VerifyProviderResponse> {
    const verifyUrl =
      buildProviderUrl(
        input.baseUrl ?? PROVIDER_BASE_URLS[providerId] ?? null,
        "/models",
      ) ?? "";
    if (verifyUrl.length === 0) {
      return { valid: false, error: "Unknown provider and no baseUrl given" };
    }

    try {
      const headers: Record<string, string> =
        providerId === "anthropic"
          ? {
              "x-api-key": input.apiKey,
              "anthropic-version": "2023-06-01",
            }
          : { Authorization: `Bearer ${input.apiKey}` };

      const response = await fetch(verifyUrl, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return { valid: false, error: `HTTP ${response.status}` };
      }

      const payload = (await response.json()) as {
        data?: Array<{ id: string }>;
      };
      return {
        valid: true,
        models: Array.isArray(payload.data)
          ? payload.data.map((item) => item.id)
          : [],
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Request failed",
      };
    }
  }
}
