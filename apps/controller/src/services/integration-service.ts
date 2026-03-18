import type {
  connectIntegrationSchema,
  refreshIntegrationSchema,
} from "@nexu/shared";
import type { z } from "zod";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

export class IntegrationService {
  constructor(private readonly configStore: NexuConfigStore) {}

  async listIntegrations() {
    return {
      integrations: await this.configStore.listIntegrations(),
    };
  }

  async connectIntegration(input: ConnectIntegrationInput) {
    return this.configStore.connectIntegration(input);
  }

  async refreshIntegration(
    integrationId: string,
    input: RefreshIntegrationInput,
  ) {
    return this.configStore.refreshIntegration(integrationId, input);
  }

  async deleteIntegration(integrationId: string) {
    return this.configStore.deleteIntegration(integrationId);
  }
}

type ConnectIntegrationInput = z.infer<typeof connectIntegrationSchema>;
type RefreshIntegrationInput = z.infer<typeof refreshIntegrationSchema>;
