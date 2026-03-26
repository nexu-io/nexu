import { selectPreferredModel } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import {
  type OAuthConnectionState,
  compileOpenClawConfig,
  resolveModelId,
} from "../lib/openclaw-config-compiler.js";
import type { OpenClawAuthProfilesStore } from "../runtime/openclaw-auth-profiles-store.js";
import type { OpenClawAuthProfilesWriter } from "../runtime/openclaw-auth-profiles-writer.js";
import type { OpenClawConfigWriter } from "../runtime/openclaw-config-writer.js";
import type { OpenClawRuntimeModelWriter } from "../runtime/openclaw-runtime-model-writer.js";
import type { OpenClawRuntimePluginWriter } from "../runtime/openclaw-runtime-plugin-writer.js";
import type { OpenClawWatchTrigger } from "../runtime/openclaw-watch-trigger.js";
import type { WorkspaceTemplateWriter } from "../runtime/workspace-template-writer.js";
import type { CompiledOpenClawStore } from "../store/compiled-openclaw-store.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { NexuConfig } from "../store/schemas.js";
import type { OpenClawGatewayService } from "./openclaw-gateway-service.js";

function resolvePrimaryModelRef(
  model: string | { primary: string } | undefined,
  config: NexuConfig,
  compiled: ReturnType<typeof compileOpenClawConfig>,
  env: ControllerEnv,
  oauthState: OAuthConnectionState,
): string {
  const availableRuntimeModels = collectRuntimeModelRefs(compiled);

  if (typeof model === "string") {
    return resolveAvailableRuntimeModel(
      resolveModelId(config, env, model, oauthState),
      availableRuntimeModels,
    );
  }

  if (model && typeof model.primary === "string") {
    return resolveAvailableRuntimeModel(
      resolveModelId(config, env, model.primary, oauthState),
      availableRuntimeModels,
    );
  }

  return resolveAvailableRuntimeModel(
    resolveModelId(config, env, env.defaultModelId, oauthState),
    availableRuntimeModels,
  );
}

function collectRuntimeModelRefs(
  compiled: ReturnType<typeof compileOpenClawConfig>,
): Array<{ id: string; name: string }> {
  const providers = compiled.models?.providers ?? {};
  return Object.entries(providers).flatMap(([providerKey, provider]) =>
    (provider.models ?? []).map((model) => ({
      id: `${providerKey}/${model.id}`,
      name: model.name ?? model.id,
    })),
  );
}

// OAuth providers whose models are managed via auth-profiles.json,
// not compiled into models.providers (no apiKey in config).
const OAUTH_PROVIDER_PREFIXES = ["openai-codex/"];

function resolveAvailableRuntimeModel(
  desiredRef: string,
  availableRuntimeModels: Array<{ id: string; name: string }>,
): string {
  if (availableRuntimeModels.some((model) => model.id === desiredRef)) {
    return desiredRef;
  }

  // Trust OAuth provider model refs — they're managed by OpenClaw's
  // auth-profiles.json and won't appear in compiled models.providers.
  if (OAUTH_PROVIDER_PREFIXES.some((prefix) => desiredRef.startsWith(prefix))) {
    return desiredRef;
  }

  return selectPreferredModel(availableRuntimeModels)?.id ?? desiredRef;
}

export class OpenClawSyncService {
  private pendingSync: Promise<{ configPushed: boolean }> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private settling = false;
  private settlingDirty = false;
  private settlingResolvers: Array<{
    resolve: (v: { configPushed: boolean }) => void;
    reject: (e: unknown) => void;
  }> = [];
  private static readonly DEBOUNCE_MS = 100;
  private static readonly SETTLING_MS = 3000;
  private syncCounter = 0;

  constructor(
    private readonly env: ControllerEnv,
    private readonly configStore: NexuConfigStore,
    private readonly compiledStore: CompiledOpenClawStore,
    private readonly configWriter: OpenClawConfigWriter,
    private readonly authProfilesWriter: OpenClawAuthProfilesWriter,
    private readonly authProfilesStore: OpenClawAuthProfilesStore,
    private readonly runtimePluginWriter: OpenClawRuntimePluginWriter,
    private readonly runtimeModelWriter: OpenClawRuntimeModelWriter,
    private readonly templateWriter: WorkspaceTemplateWriter,
    private readonly watchTrigger: OpenClawWatchTrigger,
    private readonly gatewayService: OpenClawGatewayService,
  ) {}

  async compileCurrentConfig(): Promise<
    ReturnType<typeof compileOpenClawConfig>
  > {
    const config = await this.configStore.getConfig();
    const oauthState = await this.authProfilesStore.getOAuthConnectionState();
    return compileOpenClawConfig(config, this.env, oauthState);
  }

  /**
   * Enter settling mode after bootstrap. All syncAll() calls during
   * this period are deferred. After SETTLING_MS, one final sync fires.
   * This prevents OpenClaw restart-looping during initial setup
   * (cloud connect, model selection, bot creation, etc.).
   */
  beginSettling(): void {
    this.settling = true;
    this.settlingDirty = false;
    logger.info(
      {},
      `sync settling started (${OpenClawSyncService.SETTLING_MS}ms)`,
    );
    setTimeout(() => this.endSettling(), OpenClawSyncService.SETTLING_MS);
  }

  private endSettling(): void {
    this.settling = false;
    const resolvers = [...this.settlingResolvers];
    this.settlingResolvers = [];

    if (this.settlingDirty) {
      this.settlingDirty = false;
      logger.info({}, "sync settling ended — flushing deferred sync");
      const p = this.doSync();
      p.then(
        (result) => {
          for (const r of resolvers) r.resolve(result);
        },
        (err) => {
          for (const r of resolvers) r.reject(err);
        },
      );
    } else {
      logger.info({}, "sync settling ended — no deferred changes");
      for (const r of resolvers) r.resolve({ configPushed: false });
    }
  }

  /**
   * Debounced sync: coalesces rapid calls within 100ms into a single
   * execution. During settling mode (startup), calls are deferred
   * entirely and flushed once at the end.
   */
  async syncAll(): Promise<{ configPushed: boolean }> {
    if (this.settling) {
      this.settlingDirty = true;
      logger.debug({}, "syncAll deferred (settling mode)");
      return new Promise((resolve, reject) => {
        this.settlingResolvers.push({ resolve, reject });
      });
    }

    // If a sync is already in flight, wait for it and schedule another after
    if (this.pendingSync) {
      await this.pendingSync.catch(() => {});
    }

    return new Promise((resolve, reject) => {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        const p = this.doSync();
        this.pendingSync = p;
        p.then(resolve, reject).finally(() => {
          this.pendingSync = null;
        });
      }, OpenClawSyncService.DEBOUNCE_MS);
    });
  }

  /**
   * Immediate sync bypassing debounce and settling.
   * Used during bootstrap where we need the config written before OpenClaw starts.
   */
  async syncAllImmediate(): Promise<{ configPushed: boolean }> {
    return this.doSync();
  }

  async ensureRuntimeModelPlugin(): Promise<void> {
    await this.runtimePluginWriter.ensurePlugins();
    await this.runtimeModelWriter.writeFallback();
  }

  /**
   * Write platform templates to a specific bot's workspace.
   * Called when creating a new bot to seed workspace with platform files.
   */
  async writePlatformTemplatesForBot(botId: string): Promise<void> {
    await this.templateWriter.write([{ id: botId, status: "active" }]);
  }

  private async doSync(): Promise<{ configPushed: boolean }> {
    const seq = ++this.syncCounter;
    const config = await this.configStore.getConfig();
    const oauthState = await this.authProfilesStore.getOAuthConnectionState();
    const compiled = compileOpenClawConfig(config, this.env, oauthState);

    logger.info(
      {
        seq,
        modelProviders: Object.keys(compiled.models?.providers ?? {}),
        channels: Object.keys(compiled.channels ?? {}),
        wsConnected: this.gatewayService.isConnected(),
      },
      "doSync: pushing config to OpenClaw",
    );

    // 1. Decide whether this config differs from the last observed snapshot.
    let configPushed = false;
    if (this.gatewayService.isConnected()) {
      try {
        configPushed = await this.gatewayService.shouldPushConfig(compiled);
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "openclaw config diff check failed",
        );
      }
    }

    // 2. Always write files once (persistence + watcher hot-reload path).
    await this.configWriter.write(compiled);
    await this.authProfilesWriter.writeForAgents(compiled, config.providers);
    this.gatewayService.noteConfigWritten(compiled);
    const runtimeModelRef = resolvePrimaryModelRef(
      compiled.agents.defaults?.model,
      config,
      compiled,
      this.env,
      oauthState,
    );
    logger.info({ seq, runtimeModelRef }, "doSync: resolved runtime model");
    await this.runtimeModelWriter.write(runtimeModelRef);
    await this.compiledStore.saveConfig(compiled);

    // 3. If OpenClaw is not connected yet, nudge the file watcher after the
    // write. Connected runtimes already see the single in-place overwrite.
    if (!this.gatewayService.isConnected()) {
      await this.watchTrigger.touchConfig();
    }

    logger.info({ seq, configPushed }, "doSync: complete");
    return { configPushed };
  }
}
