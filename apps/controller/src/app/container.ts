import { logger } from "../lib/logger.js";
import { GatewayClient } from "../runtime/gateway-client.js";
import { startHealthLoop } from "../runtime/loops.js";
import { startAnalyticsLoop } from "../runtime/loops.js";
import { OpenClawAuthProfilesStore } from "../runtime/openclaw-auth-profiles-store.js";
import { OpenClawAuthProfilesWriter } from "../runtime/openclaw-auth-profiles-writer.js";
import { OpenClawConfigWriter } from "../runtime/openclaw-config-writer.js";
import { OpenClawProcessManager } from "../runtime/openclaw-process.js";
import { OpenClawRuntimeModelWriter } from "../runtime/openclaw-runtime-model-writer.js";
import { OpenClawRuntimePluginWriter } from "../runtime/openclaw-runtime-plugin-writer.js";
import { OpenClawWatchTrigger } from "../runtime/openclaw-watch-trigger.js";
import { OpenClawWsClient } from "../runtime/openclaw-ws-client.js";
import { RuntimeHealth } from "../runtime/runtime-health.js";
import { SessionsRuntime } from "../runtime/sessions-runtime.js";
import {
  type ControllerRuntimeState,
  createRuntimeState,
} from "../runtime/state.js";
import { WorkspaceTemplateWriter } from "../runtime/workspace-template-writer.js";
import { AgentService } from "../services/agent-service.js";
import { AnalyticsService } from "../services/analytics-service.js";
import { ArtifactService } from "../services/artifact-service.js";
import { ChannelFallbackService } from "../services/channel-fallback-service.js";
import { ChannelService } from "../services/channel-service.js";
import { DesktopLocalService } from "../services/desktop-local-service.js";
import { IntegrationService } from "../services/integration-service.js";
import { LocalUserService } from "../services/local-user-service.js";
import { ModelProviderService } from "../services/model-provider-service.js";
import { OpenClawAuthService } from "../services/openclaw-auth-service.js";
import { OpenClawGatewayService } from "../services/openclaw-gateway-service.js";
import { OpenClawSyncService } from "../services/openclaw-sync-service.js";
import { RuntimeConfigService } from "../services/runtime-config-service.js";
import { RuntimeModelStateService } from "../services/runtime-model-state-service.js";
import { SessionService } from "../services/session-service.js";
import { SkillhubService } from "../services/skillhub-service.js";
import { TemplateService } from "../services/template-service.js";
import { ArtifactsStore } from "../store/artifacts-store.js";
import { CompiledOpenClawStore } from "../store/compiled-openclaw-store.js";
import { NexuConfigStore } from "../store/nexu-config-store.js";
import { type ControllerEnv, env } from "./env.js";

export interface ControllerContainer {
  env: ControllerEnv;
  configStore: NexuConfigStore;
  gatewayClient: GatewayClient;
  runtimeHealth: RuntimeHealth;
  openclawProcess: OpenClawProcessManager;
  agentService: AgentService;
  channelService: ChannelService;
  channelFallbackService: ChannelFallbackService;
  sessionService: SessionService;
  runtimeConfigService: RuntimeConfigService;
  runtimeModelStateService: RuntimeModelStateService;
  modelProviderService: ModelProviderService;
  integrationService: IntegrationService;
  localUserService: LocalUserService;
  desktopLocalService: DesktopLocalService;
  analyticsService: AnalyticsService;
  artifactService: ArtifactService;
  templateService: TemplateService;
  skillhubService: SkillhubService;
  openclawSyncService: OpenClawSyncService;
  openclawAuthService: OpenClawAuthService;
  wsClient: OpenClawWsClient;
  gatewayService: OpenClawGatewayService;
  runtimeState: ControllerRuntimeState;
  startBackgroundLoops: () => () => void;
}

const NEXU_OFFICIAL_MODEL_REFRESH_INTERVAL_MS = 60 * 1000;

export async function createContainer(): Promise<ControllerContainer> {
  const configStore = new NexuConfigStore(env);
  await configStore.reconcileConfiguredDesktopCloudState();
  if (env.manageOpenclawProcess) {
    await configStore.syncManagedRuntimeGateway({
      port: env.openclawGatewayPort,
      authMode: env.openclawGatewayToken ? "token" : "none",
    });
  }
  const artifactsStore = new ArtifactsStore(env);
  const compiledStore = new CompiledOpenClawStore(env);
  const configWriter = new OpenClawConfigWriter(env);
  const authProfilesStore = new OpenClawAuthProfilesStore(env);
  const authProfilesWriter = new OpenClawAuthProfilesWriter(authProfilesStore);
  const runtimePluginWriter = new OpenClawRuntimePluginWriter(env);
  const runtimeModelWriter = new OpenClawRuntimeModelWriter(env);
  const templateWriter = new WorkspaceTemplateWriter(env);
  const watchTrigger = new OpenClawWatchTrigger(env);
  const gatewayClient = new GatewayClient(env);
  const sessionsRuntime = new SessionsRuntime(env);
  const runtimeHealth = new RuntimeHealth(env);
  const runtimeState = createRuntimeState();
  const openclawProcess = new OpenClawProcessManager(env);
  const wsClient = new OpenClawWsClient(env);
  const gatewayService = new OpenClawGatewayService(wsClient, runtimeState);
  const channelFallbackService = new ChannelFallbackService(
    openclawProcess,
    gatewayService,
    {
      getLocale: () => configStore.getDesktopLocale(),
    },
  );
  let syncService: OpenClawSyncService | null = null;
  const skillhubService = await SkillhubService.create(env, {
    onSyncNeeded: () => {
      void syncService?.syncAll().catch(() => {});
    },
    getBotIds: async () => {
      const config = await configStore.getConfig();
      return config.bots.map((b) => b.id);
    },
  });
  const openclawSyncService = new OpenClawSyncService(
    env,
    configStore,
    compiledStore,
    configWriter,
    authProfilesWriter,
    authProfilesStore,
    runtimePluginWriter,
    runtimeModelWriter,
    templateWriter,
    watchTrigger,
    gatewayService,
    skillhubService.skillDb,
    skillhubService.workspaceSkillScanner,
  );
  syncService = openclawSyncService;
  const openclawAuthService = new OpenClawAuthService(env, authProfilesStore);
  const analyticsService = new AnalyticsService(
    env,
    configStore,
    sessionsRuntime,
  );
  const modelProviderService = new ModelProviderService(
    configStore,
    env,
    openclawSyncService,
    openclawProcess,
  );
  modelProviderService.setAuthService(openclawAuthService);
  const runtimeModelStateService = new RuntimeModelStateService(env);

  // Wire cloud state change callback to sync refreshed cloud inventory without
  // auto-switching the default model during startup or first-channel connect.
  configStore.onCloudStateChanged = async (change) => {
    await openclawSyncService.syncAll();
    if (!change.hadCloudInventory && change.hasCloudInventory) {
      await openclawProcess.stop();
      openclawProcess.enableAutoRestart();
      openclawProcess.start();
    }
  };

  return {
    env,
    gatewayClient,
    runtimeHealth,
    openclawProcess,
    agentService: new AgentService(configStore, openclawSyncService),
    channelService: new ChannelService(
      env,
      configStore,
      openclawSyncService,
      gatewayService,
    ),
    channelFallbackService,
    sessionService: new SessionService(sessionsRuntime),
    runtimeConfigService: new RuntimeConfigService(
      configStore,
      openclawSyncService,
    ),
    runtimeModelStateService,
    modelProviderService,
    integrationService: new IntegrationService(configStore),
    localUserService: new LocalUserService(configStore),
    desktopLocalService: new DesktopLocalService(
      configStore,
      modelProviderService,
      openclawProcess,
    ),
    analyticsService,
    artifactService: new ArtifactService(artifactsStore),
    templateService: new TemplateService(configStore, openclawSyncService),
    skillhubService,
    openclawSyncService,
    openclawAuthService,
    wsClient,
    gatewayService,
    configStore,
    runtimeState,
    startBackgroundLoops: () => {
      let isRefreshingNexuOfficialModels = false;
      const stopHealthLoop = startHealthLoop({
        env,
        state: runtimeState,
        runtimeHealth,
        processManager: openclawProcess,
        wsClient,
      });
      const stopAnalyticsLoop = startAnalyticsLoop({
        env,
        analyticsService,
      });
      const nexuOfficialModelRefreshInterval = setInterval(() => {
        if (isRefreshingNexuOfficialModels) {
          return;
        }

        isRefreshingNexuOfficialModels = true;
        void modelProviderService
          .refreshNexuOfficialModels()
          .catch((error) => {
            logger.warn(
              {
                error: error instanceof Error ? error.message : String(error),
              },
              "nexu_official_model_refresh_failed",
            );
          })
          .finally(() => {
            isRefreshingNexuOfficialModels = false;
          });
      }, NEXU_OFFICIAL_MODEL_REFRESH_INTERVAL_MS);
      nexuOfficialModelRefreshInterval.unref?.();
      skillhubService.start();

      return () => {
        stopHealthLoop();
        stopAnalyticsLoop();
        clearInterval(nexuOfficialModelRefreshInterval);
        skillhubService.dispose();
        openclawAuthService.dispose();
        channelFallbackService.stop();
        wsClient.stop();
      };
    },
  };
}
