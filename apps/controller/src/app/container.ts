import { GatewayClient } from "../runtime/gateway-client.js";
import { startHealthLoop } from "../runtime/loops.js";
import { startAnalyticsLoop } from "../runtime/loops.js";
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
  wsClient: OpenClawWsClient;
  gatewayService: OpenClawGatewayService;
  runtimeState: ControllerRuntimeState;
  startBackgroundLoops: () => () => void;
}

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
  const authProfilesWriter = new OpenClawAuthProfilesWriter();
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
  const gatewayService = new OpenClawGatewayService(wsClient);
  const channelFallbackService = new ChannelFallbackService(
    openclawProcess,
    gatewayService,
    {
      getLocale: () => configStore.getDesktopLocale(),
    },
  );
  const openclawSyncService = new OpenClawSyncService(
    env,
    configStore,
    compiledStore,
    configWriter,
    authProfilesWriter,
    runtimePluginWriter,
    runtimeModelWriter,
    templateWriter,
    watchTrigger,
    gatewayService,
  );
  const skillhubService = await SkillhubService.create(env);
  const analyticsService = new AnalyticsService(
    env,
    configStore,
    sessionsRuntime,
  );
  const modelProviderService = new ModelProviderService(
    configStore,
    env.nodeEnv,
  );
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
    channelService: new ChannelService(configStore, openclawSyncService),
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
    wsClient,
    gatewayService,
    configStore,
    runtimeState,
    startBackgroundLoops: () => {
      const stopHealthLoop = startHealthLoop({
        env,
        state: runtimeState,
        runtimeHealth,
        processManager: openclawProcess,
      });
      const stopAnalyticsLoop = startAnalyticsLoop({
        env,
        analyticsService,
      });
      skillhubService.start();

      return () => {
        stopHealthLoop();
        stopAnalyticsLoop();
        skillhubService.dispose();
        channelFallbackService.stop();
        wsClient.stop();
      };
    },
  };
}
