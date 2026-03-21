import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import { compileOpenClawConfig } from "../lib/openclaw-config-compiler.js";
import type { OpenClawConfigWriter } from "../runtime/openclaw-config-writer.js";
import type { OpenClawRuntimeModelWriter } from "../runtime/openclaw-runtime-model-writer.js";
import type { OpenClawRuntimePluginWriter } from "../runtime/openclaw-runtime-plugin-writer.js";
import type { OpenClawWatchTrigger } from "../runtime/openclaw-watch-trigger.js";
import type { WorkspaceTemplateWriter } from "../runtime/workspace-template-writer.js";
import type { CompiledOpenClawStore } from "../store/compiled-openclaw-store.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { OpenClawGatewayService } from "./openclaw-gateway-service.js";

function resolvePrimaryModelRef(
  model: string | { primary: string } | undefined,
): string {
  if (typeof model === "string") {
    return model;
  }

  if (model && typeof model.primary === "string") {
    return model.primary;
  }

  return "anthropic/claude-opus-4-6";
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
    return compileOpenClawConfig(config, this.env);
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
    const compiled = compileOpenClawConfig(config, this.env);

    logger.info(
      {
        seq,
        modelProviders: Object.keys(compiled.models?.providers ?? {}),
        channels: Object.keys(compiled.channels ?? {}),
        wsConnected: this.gatewayService.isConnected(),
      },
      "doSync: pushing config to OpenClaw",
    );

    // 1. Try WS push first (instant effect)
    let configPushed = false;
    if (this.gatewayService.isConnected()) {
      try {
        configPushed = await this.gatewayService.pushConfig(compiled);
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          "openclaw WS push failed",
        );
      }
    }

    // 2. Always write files (persistence + cold-start fallback)
    await this.configWriter.write(compiled);
    await this.runtimeModelWriter.write(
      resolvePrimaryModelRef(compiled.agents.defaults?.model),
    );
    await this.compiledStore.saveConfig(compiled);

    // 3. Only touch watch trigger when WS push failed (file-watch hot-reload)
    if (!configPushed) {
      await this.watchTrigger.touchConfig();
    }

    logger.info({ seq, configPushed }, "doSync: complete");
    return { configPushed };
  }
}
