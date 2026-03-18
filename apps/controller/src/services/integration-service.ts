import {
  connectIntegrationResponseSchema,
  type connectIntegrationSchema,
  integrationListResponseSchema,
  integrationResponseSchema,
  type refreshIntegrationSchema,
} from "@nexu/shared";
import type { z } from "zod";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

const TOOLKIT_CATALOG: Array<{
  slug: string;
  displayName: string;
  description: string;
  iconUrl: string;
  fallbackIconUrl: string;
  category: string;
  authScheme: "oauth2" | "api_key_user";
  authFields?: Array<{ key: string; label: string; type: "text" | "secret" }>;
}> = [
  {
    slug: "notion",
    displayName: "Notion",
    description: "Connect Notion workspaces and pages.",
    iconUrl: "/toolkit-icons/notion.svg",
    fallbackIconUrl:
      "https://www.google.com/s2/favicons?domain=notion.so&sz=64",
    category: "knowledge",
    authScheme: "oauth2",
  },
  {
    slug: "github",
    displayName: "GitHub",
    description: "Connect repositories, issues, and pull requests.",
    iconUrl: "/toolkit-icons/github.svg",
    fallbackIconUrl:
      "https://www.google.com/s2/favicons?domain=github.com&sz=64",
    category: "developer",
    authScheme: "oauth2",
  },
  {
    slug: "slack",
    displayName: "Slack",
    description: "Connect Slack workspace APIs.",
    iconUrl: "/toolkit-icons/slack.svg",
    fallbackIconUrl:
      "https://www.google.com/s2/favicons?domain=slack.com&sz=64",
    category: "communication",
    authScheme: "oauth2",
  },
  {
    slug: "openai",
    displayName: "OpenAI API",
    description: "Use your own OpenAI-compatible API key.",
    iconUrl: "/toolkit-icons/openai.svg",
    fallbackIconUrl:
      "https://www.google.com/s2/favicons?domain=openai.com&sz=64",
    category: "ai",
    authScheme: "api_key_user",
    authFields: [{ key: "apiKey", label: "API Key", type: "secret" }],
  },
];

function getToolkitInfo(slug: string) {
  return (
    TOOLKIT_CATALOG.find((toolkit) => toolkit.slug === slug) ?? {
      slug,
      displayName: slug,
      description: "Controller-managed integration",
      iconUrl: `/toolkit-icons/${slug}.svg`,
      fallbackIconUrl: "https://www.google.com/s2/favicons?sz=64",
      category: "tooling",
      authScheme: "oauth2" as const,
    }
  );
}

function withToolkit<T extends { toolkit: { slug: string } }>(
  integration: T,
): T {
  return {
    ...integration,
    toolkit: {
      ...getToolkitInfo(integration.toolkit.slug),
      ...integration.toolkit,
    },
  };
}

export class IntegrationService {
  constructor(private readonly configStore: NexuConfigStore) {}

  async listIntegrations() {
    const saved = await this.configStore.listIntegrations();
    const bySlug = new Map(
      saved.map((integration) => [
        integration.toolkit.slug,
        withToolkit(integration),
      ]),
    );
    const merged: Array<z.infer<typeof integrationResponseSchema>> =
      TOOLKIT_CATALOG.map((toolkit) =>
        integrationResponseSchema.parse(
          bySlug.get(toolkit.slug) ?? {
            toolkit,
            status: "pending",
          },
        ),
      );

    for (const integration of saved) {
      if (!bySlug.has(integration.toolkit.slug)) {
        merged.push(integrationResponseSchema.parse(withToolkit(integration)));
      }
    }

    return integrationListResponseSchema.parse({ integrations: merged });
  }

  async connectIntegration(input: ConnectIntegrationInput) {
    const toolkit = getToolkitInfo(input.toolkitSlug);
    const result = await this.configStore.connectIntegration(input);
    const connectUrl =
      toolkit.authScheme === "oauth2" && !input.credentials
        ? `${input.returnTo ?? "/workspace/integrations"}?toolkit=${toolkit.slug}&state=${result.state ?? "local-state"}`
        : undefined;

    return connectIntegrationResponseSchema.parse({
      ...result,
      integration: {
        ...withToolkit(result.integration),
        toolkit,
        status:
          toolkit.authScheme === "oauth2" && !input.credentials
            ? "initiated"
            : "active",
        connectUrl,
      },
      connectUrl,
    });
  }

  async refreshIntegration(
    integrationId: string,
    input: RefreshIntegrationInput,
  ) {
    const integration = await this.configStore.refreshIntegration(
      integrationId,
      input,
    );
    return integration
      ? integrationResponseSchema.parse(withToolkit(integration))
      : null;
  }

  async deleteIntegration(integrationId: string) {
    const integration = await this.configStore.deleteIntegration(integrationId);
    return integration
      ? integrationResponseSchema.parse(withToolkit(integration))
      : null;
  }
}

type ConnectIntegrationInput = z.infer<typeof connectIntegrationSchema>;
type RefreshIntegrationInput = z.infer<typeof refreshIntegrationSchema>;
