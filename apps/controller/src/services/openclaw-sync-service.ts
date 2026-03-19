import type { ControllerEnv } from "../app/env.js";
import { compileOpenClawConfig } from "../lib/openclaw-config-compiler.js";
import type { OpenClawConfigWriter } from "../runtime/openclaw-config-writer.js";
import type { OpenClawSkillsWriter } from "../runtime/openclaw-skills-writer.js";
import type { OpenClawWatchTrigger } from "../runtime/openclaw-watch-trigger.js";
import type { WorkspaceTemplateWriter } from "../runtime/workspace-template-writer.js";
import type { CompiledOpenClawStore } from "../store/compiled-openclaw-store.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

export class OpenClawSyncService {
  constructor(
    private readonly env: ControllerEnv,
    private readonly configStore: NexuConfigStore,
    private readonly compiledStore: CompiledOpenClawStore,
    private readonly configWriter: OpenClawConfigWriter,
    private readonly skillsWriter: OpenClawSkillsWriter,
    private readonly templateWriter: WorkspaceTemplateWriter,
    private readonly watchTrigger: OpenClawWatchTrigger,
  ) {}

  async syncAll(): Promise<void> {
    const config = await this.configStore.getConfig();
    const compiled = compileOpenClawConfig(config, this.env);
    await this.configWriter.write(compiled);
    await this.compiledStore.saveConfig(compiled);
    await this.skillsWriter.materialize(config.skills);
    await this.templateWriter.write(Object.values(config.templates));
    await this.watchTrigger.touchConfig();
  }
}
