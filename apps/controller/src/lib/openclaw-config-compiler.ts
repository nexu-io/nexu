import { type OpenClawConfig, openclawConfigSchema } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import type { NexuConfig } from "../store/schemas.js";
import {
  compileChannelBindings,
  compileChannelsConfig,
} from "./channel-binding-compiler.js";

function compileModelsConfig(config: NexuConfig): OpenClawConfig["models"] {
  const providers = Object.fromEntries(
    config.providers
      .filter((provider) => provider.enabled && provider.apiKey !== null)
      .map((provider) => [
        provider.providerId,
        {
          baseUrl: provider.baseUrl ?? "https://api.openai.com/v1",
          apiKey: provider.apiKey ?? "",
          api: "openai",
          models: provider.models.map((modelId) => ({
            id: modelId,
            name: modelId,
          })),
        },
      ]),
  );

  if (Object.keys(providers).length === 0) {
    return undefined;
  }

  return {
    mode: "merge",
    providers,
  };
}

export function compileOpenClawConfig(
  config: NexuConfig,
  env: ControllerEnv,
): OpenClawConfig {
  const openClawConfig: OpenClawConfig = {
    gateway: {
      port: config.runtime.gateway.port,
      mode: "local",
      bind: config.runtime.gateway.bind,
      auth: {
        mode: config.runtime.gateway.authMode,
        ...(env.openclawGatewayToken
          ? { token: env.openclawGatewayToken }
          : {}),
      },
      reload: {
        mode: "hybrid",
      },
      controlUi: {
        allowedOrigins: [env.webUrl],
      },
    },
    models: compileModelsConfig(config),
    agents: {
      defaults: {
        model: config.runtime.defaultModelId,
      },
      list: config.bots
        .filter((bot) => bot.status === "active")
        .map((bot, index) => ({
          id: bot.id,
          name: bot.name,
          default: index === 0,
          model: bot.modelId,
        })),
    },
    channels: compileChannelsConfig({
      channels: config.channels,
      secrets: config.secrets,
    }),
    bindings: compileChannelBindings(config.bots, config.channels),
    skills: {
      load: {
        watch: true,
        watchDebounceMs: 250,
      },
    },
    commands: {
      native: "auto",
      nativeSkills: "auto",
      restart: true,
    },
    session: {
      dmScope: "per-channel-peer",
    },
    messages: {
      ackReactionScope: "group-mentions",
    },
    diagnostics: {
      enabled: true,
    },
  };

  return openclawConfigSchema.parse(openClawConfig);
}
