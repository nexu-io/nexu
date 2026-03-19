import { GatewayClient } from "../runtime/gateway-client.js";
import { startHealthLoop, startSyncLoop } from "../runtime/loops.js";
import { OpenClawConfigWriter } from "../runtime/openclaw-config-writer.js";
import { OpenClawProcessManager } from "../runtime/openclaw-process.js";
import { OpenClawSkillsWriter } from "../runtime/openclaw-skills-writer.js";
import { OpenClawWatchTrigger } from "../runtime/openclaw-watch-trigger.js";
import { RuntimeHealth } from "../runtime/runtime-health.js";
import { SessionsRuntime } from "../runtime/sessions-runtime.js";
import {
  type ControllerRuntimeState,
  createRuntimeState,
} from "../runtime/state.js";
import { WorkspaceTemplateWriter } from "../runtime/workspace-template-writer.js";
import { AgentService } from "../services/agent-service.js";
import { ArtifactService } from "../services/artifact-service.js";
import { ChannelService } from "../services/channel-service.js";
import { DesktopLocalService } from "../services/desktop-local-service.js";
import { IntegrationService } from "../services/integration-service.js";
import { LocalUserService } from "../services/local-user-service.js";
import { ModelProviderService } from "../services/model-provider-service.js";
import { OpenClawSyncService } from "../services/openclaw-sync-service.js";
import { RuntimeConfigService } from "../services/runtime-config-service.js";
import { SessionService } from "../services/session-service.js";
import { SkillService } from "../services/skill-service.js";
import { TemplateService } from "../services/template-service.js";
import { ArtifactsStore } from "../store/artifacts-store.js";
import { CompiledOpenClawStore } from "../store/compiled-openclaw-store.js";
import { NexuConfigStore } from "../store/nexu-config-store.js";
import { type ControllerEnv, env } from "./env.js";

export interface ControllerContainer {
  env: ControllerEnv;
  gatewayClient: GatewayClient;
  runtimeHealth: RuntimeHealth;
  openclawProcess: OpenClawProcessManager;
  agentService: AgentService;
  channelService: ChannelService;
  sessionService: SessionService;
  skillService: SkillService;
  runtimeConfigService: RuntimeConfigService;
  modelProviderService: ModelProviderService;
  integrationService: IntegrationService;
  localUserService: LocalUserService;
  desktopLocalService: DesktopLocalService;
  artifactService: ArtifactService;
  templateService: TemplateService;
  openclawSyncService: OpenClawSyncService;
  runtimeState: ControllerRuntimeState;
  startBackgroundLoops: () => () => void;
}

export function createContainer(): ControllerContainer {
  const configStore = new NexuConfigStore(env);
  const artifactsStore = new ArtifactsStore(env);
  const compiledStore = new CompiledOpenClawStore(env);
  const configWriter = new OpenClawConfigWriter(env);
  const skillsWriter = new OpenClawSkillsWriter(env);
  const templateWriter = new WorkspaceTemplateWriter(env);
  const watchTrigger = new OpenClawWatchTrigger(env);
  const gatewayClient = new GatewayClient(env);
  const sessionsRuntime = new SessionsRuntime(env);
  const runtimeHealth = new RuntimeHealth(env);
  const runtimeState = createRuntimeState();
  const openclawProcess = new OpenClawProcessManager(env);
  const openclawSyncService = new OpenClawSyncService(
    env,
    configStore,
    compiledStore,
    configWriter,
    skillsWriter,
    templateWriter,
    watchTrigger,
  );

  return {
    env,
    gatewayClient,
    runtimeHealth,
    openclawProcess,
    agentService: new AgentService(configStore, openclawSyncService),
    channelService: new ChannelService(configStore, openclawSyncService),
    sessionService: new SessionService(sessionsRuntime),
    skillService: new SkillService(configStore, openclawSyncService),
    runtimeConfigService: new RuntimeConfigService(
      configStore,
      openclawSyncService,
    ),
    modelProviderService: new ModelProviderService(configStore),
    integrationService: new IntegrationService(configStore),
    localUserService: new LocalUserService(configStore),
    desktopLocalService: new DesktopLocalService(configStore),
    artifactService: new ArtifactService(artifactsStore),
    templateService: new TemplateService(configStore, openclawSyncService),
    openclawSyncService,
    runtimeState,
    startBackgroundLoops: () => {
      const stopSyncLoop = startSyncLoop({
        env,
        state: runtimeState,
        syncService: openclawSyncService,
      });
      const stopHealthLoop = startHealthLoop({
        env,
        state: runtimeState,
        runtimeHealth,
        processManager: openclawProcess,
      });

      return () => {
        stopSyncLoop();
        stopHealthLoop();
      };
    },
  };
}
