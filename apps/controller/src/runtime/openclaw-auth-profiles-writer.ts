import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "@nexu/shared";

type AuthProfileStore = {
  version: number;
  profiles: Record<
    string,
    {
      type: "api_key";
      provider: string;
      key: string;
    }
  >;
};

export class OpenClawAuthProfilesWriter {
  async writeForAgents(config: OpenClawConfig): Promise<void> {
    const providers = config.models?.providers ?? {};
    const profiles = Object.fromEntries(
      Object.entries(providers)
        .filter(
          ([, provider]) =>
            typeof provider.apiKey === "string" && provider.apiKey.length > 0,
        )
        .map(([providerId, provider]) => [
          `${providerId}:default`,
          {
            type: "api_key" as const,
            provider: providerId,
            key: provider.apiKey as string,
          },
        ]),
    );

    const payload: AuthProfileStore = {
      version: 1,
      profiles,
    };

    await Promise.all(
      (config.agents?.list ?? []).map(async (agent) => {
        if (
          typeof agent.workspace !== "string" ||
          agent.workspace.length === 0
        ) {
          return;
        }
        const authProfilesPath = path.join(
          agent.workspace,
          "agent",
          "auth-profiles.json",
        );
        await mkdir(path.dirname(authProfilesPath), { recursive: true });
        await writeFile(
          authProfilesPath,
          `${JSON.stringify(payload, null, 2)}\n`,
          "utf8",
        );
      }),
    );
  }
}
