import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { selectPreferredModel } from "@nexu/shared";
import type { OpenClawConfig } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import {
  type OAuthConnectionState,
  compileOpenClawConfig,
  resolveModelId,
} from "../lib/openclaw-config-compiler.js";
import type { CreditGuardStateWriter } from "../runtime/credit-guard-state-writer.js";
import type { OpenClawAuthProfilesStore } from "../runtime/openclaw-auth-profiles-store.js";
import type { OpenClawAuthProfilesWriter } from "../runtime/openclaw-auth-profiles-writer.js";
import type { OpenClawConfigWriter } from "../runtime/openclaw-config-writer.js";
import type { OpenClawRuntimeModelWriter } from "../runtime/openclaw-runtime-model-writer.js";
import { resolveNoModelConfiguredMessage } from "../runtime/openclaw-runtime-model-writer.js";
import type { OpenClawRuntimePluginWriter } from "../runtime/openclaw-runtime-plugin-writer.js";
import type { OpenClawWatchTrigger } from "../runtime/openclaw-watch-trigger.js";
import type { WorkspaceTemplateWriter } from "../runtime/workspace-template-writer.js";
import type { CompiledOpenClawStore } from "../store/compiled-openclaw-store.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { NexuConfig } from "../store/schemas.js";
import type { OpenClawGatewayService } from "./openclaw-gateway-service.js";
import type { SkillDb } from "./skillhub/skill-db.js";
import type { WorkspaceSkillScanner } from "./skillhub/workspace-skill-scanner.js";

function resolvePrimaryModelRef(
  model: string | { primary: string } | undefined,
  config: NexuConfig,
  compiled: ReturnType<typeof compileOpenClawConfig>,
  env: ControllerEnv,
  oauthState: OAuthConnectionState,
): string {
  const availableRuntimeModels = collectRuntimeModelRefs(compiled);
  const configuredProviderKeys = new Set(
    Object.keys(compiled.models?.providers ?? {}),
  );

  if (typeof model === "string") {
    return resolveAvailableRuntimeModel(
      resolveModelId(config, env, model, oauthState),
      availableRuntimeModels,
      configuredProviderKeys,
    );
  }

  if (model && typeof model.primary === "string") {
    return resolveAvailableRuntimeModel(
      resolveModelId(config, env, model.primary, oauthState),
      availableRuntimeModels,
      configuredProviderKeys,
    );
  }

  return resolveAvailableRuntimeModel(
    resolveModelId(config, env, env.defaultModelId, oauthState),
    availableRuntimeModels,
    configuredProviderKeys,
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
  configuredProviderKeys: ReadonlySet<string>,
): string {
  if (availableRuntimeModels.some((model) => model.id === desiredRef)) {
    return desiredRef;
  }

  // Trust OAuth provider model refs — they're managed by OpenClaw's
  // auth-profiles.json and won't appear in compiled models.providers.
  if (OAUTH_PROVIDER_PREFIXES.some((prefix) => desiredRef.startsWith(prefix))) {
    return desiredRef;
  }

  // Trust any model ref whose provider is configured in compiled.models.providers,
  // even if the provider's explicit `models` list is empty. This covers BYOK
  // flows where the user enabled a provider (e.g. Anthropic) with their own
  // API key but never added models to its allowlist — OpenClaw's
  // resolveModelWithRegistry has a generic-fallback path that builds a
  // synthetic model entry when providerConfig is present, so the request
  // still goes through. Without this, the user's explicit selection is
  // silently overridden with the link default.
  const providerKey = desiredRef.split("/", 1)[0];
  if (providerKey && configuredProviderKeys.has(providerKey)) {
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
    private readonly creditGuardStateWriter: CreditGuardStateWriter,
    private readonly templateWriter: WorkspaceTemplateWriter,
    private readonly watchTrigger: OpenClawWatchTrigger,
    private readonly gatewayService: OpenClawGatewayService,
    private readonly skillDb: SkillDb | null = null,
    private readonly workspaceScanner: WorkspaceSkillScanner | null = null,
  ) {}

  async compileCurrentConfig(): Promise<
    ReturnType<typeof compileOpenClawConfig>
  > {
    const config = await this.configStore.getConfig();
    const oauthState = await this.authProfilesStore.getOAuthConnectionState();
    const installedSlugs = this.skillDb
      ? this.skillDb
          .getAllInstalled()
          .filter((r) => r.source !== "workspace")
          .map((r) => r.slug)
          .sort((left, right) => left.localeCompare(right))
      : undefined;

    const workspaceMap = this.workspaceScanner
      ? this.workspaceScanner.scanAll(
          config.bots.filter((b) => b.status === "active").map((b) => b.id),
        )
      : undefined;

    return compileOpenClawConfig(
      config,
      this.env,
      oauthState,
      installedSlugs,
      workspaceMap,
    );
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
   * Seed platform templates into a specific bot's workspace.
   *
   * Should only be called once per bot, at creation time
   * (`AgentService.createBot`). The underlying writer is strictly
   * seed-if-missing — it never overwrites — so a duplicate call is a
   * harmless no-op, but it is conceptually wrong: agents read/write these
   * platform docs at runtime, and any caller that re-seeds is implicitly
   * claiming the bot's workspace state should be reset.
   */
  async writePlatformTemplatesForBot(botId: string): Promise<void> {
    await this.templateWriter.write([{ id: botId, status: "active" }]);
  }

  private async doSync(): Promise<{ configPushed: boolean }> {
    const seq = ++this.syncCounter;
    const config = await this.configStore.getConfig();
    const oauthState = await this.authProfilesStore.getOAuthConnectionState();
    const installedSlugs = this.skillDb
      ? this.skillDb
          .getAllInstalled()
          .filter((r) => r.source !== "workspace")
          .map((r) => r.slug)
      : undefined;

    const workspaceMap = this.workspaceScanner
      ? this.workspaceScanner.scanAll(
          config.bots.filter((b) => b.status === "active").map((b) => b.id),
        )
      : undefined;

    const rawCompiled = compileOpenClawConfig(
      config,
      this.env,
      oauthState,
      installedSlugs,
      workspaceMap,
    );

    const hasAnyProvider =
      Object.keys(rawCompiled.models?.providers ?? {}).length > 0;

    // When no model provider is configured (e.g. after link logout with no
    // BYOK keys), strip the model from agents so OpenClaw cannot fall back
    // to its built-in registry with the bare model name. This normalization
    // must happen BEFORE shouldPushConfig() — otherwise the pre-normalized
    // hash we diff against diverges from the post-normalized hash we store
    // via noteConfigWritten(), which would mark every subsequent no-provider
    // sync as changed and trigger spurious touchAnySkillMarker() runs.
    // Rebuild immutably (no in-place mutation of the compiled object).
    const compiled: OpenClawConfig = hasAnyProvider
      ? rawCompiled
      : {
          ...rawCompiled,
          agents: {
            ...rawCompiled.agents,
            defaults: rawCompiled.agents.defaults
              ? { ...rawCompiled.agents.defaults, model: undefined }
              : rawCompiled.agents.defaults,
            list: (rawCompiled.agents.list ?? []).map((agent) =>
              agent.model ? { ...agent, model: undefined } : agent,
            ),
          },
        };

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
    await this.authProfilesWriter.writeForAgents(
      compiled,
      config.models.providers,
    );
    this.gatewayService.noteConfigWritten(compiled);
    const runtimeModelRef = hasAnyProvider
      ? resolvePrimaryModelRef(
          compiled.agents.defaults?.model,
          config,
          compiled,
          this.env,
          oauthState,
        )
      : null;
    logger.info({ seq, runtimeModelRef }, "doSync: resolved runtime model");
    // Write locale state for the credit-guard patch in OpenClaw runtime.
    // Match the controller's own locale default: unset → "en" (not "zh-CN").
    const locale =
      (config.desktop as Record<string, unknown>).locale === "zh-CN"
        ? "zh-CN"
        : "en";
    if (runtimeModelRef) {
      await this.runtimeModelWriter.write(runtimeModelRef);
    } else {
      // TODO(alche): This writes `noModelMessage` into the runtime-model state
      // file, but the downstream OpenClaw/runtime consumer still primarily acts
      // on non-empty `selectedModelRef` / `promptNotice`. Wire that reader path
      // to surface `noModelMessage` explicitly so users see this guidance
      // instead of falling through to a generic runtime/provider error.
      await this.runtimeModelWriter.writeNoModelState(
        resolveNoModelConfiguredMessage(locale),
      );
    }
    await this.creditGuardStateWriter.write(locale);
    await this.compiledStore.saveConfig(compiled);

    // 3. If OpenClaw is not connected yet, nudge the file watcher after the
    // write. Connected runtimes already see the single in-place overwrite.
    if (!this.gatewayService.isConnected()) {
      await this.watchTrigger.touchConfig();
    }

    // 4. Nudge OpenClaw's skills chokidar watcher so it bumps snapshotVersion.
    // Without this, existing sessions keep using a stale skills snapshot
    // even after the allowlist changes, because OpenClaw's config-reload
    // treats agents/skills changes as kind "none" (no hot-reload action).
    if (configPushed) {
      await this.touchAnySkillMarker();
    }

    logger.info({ seq, configPushed }, "doSync: complete");
    return { configPushed };
  }

  /**
   * Touch one SKILL.md to trigger OpenClaw's skills chokidar watcher.
   * Best-effort: silently ignored if no skills exist on disk yet.
   */
  private async touchAnySkillMarker(): Promise<void> {
    try {
      const entries = await import("node:fs/promises").then((fs) =>
        fs.readdir(this.env.openclawSkillsDir, { withFileTypes: true }),
      );
      const first = entries.find(
        (e) =>
          e.isDirectory() &&
          existsSync(resolve(this.env.openclawSkillsDir, e.name, "SKILL.md")),
      );
      if (first) {
        await this.watchTrigger.touchSkill(first.name);
        logger.info(
          { slug: first.name },
          "doSync: touched SKILL.md to bump snapshot version",
        );
      }
    } catch {
      // best-effort
    }
  }
}
