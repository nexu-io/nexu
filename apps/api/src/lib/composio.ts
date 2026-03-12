import { Composio } from "@composio/core";
import { HTTPException } from "hono/http-exception";

const composioClients = new Map<string, Composio>();

function getClient(apiKey: string): Composio {
  const existing = composioClients.get(apiKey);
  if (existing) return existing;
  const client = new Composio({ apiKey });
  composioClients.set(apiKey, client);
  return client;
}

export async function initializeOAuthConnection(
  apiKey: string,
  toolkitSlug: string,
  nexuUserId: string,
  _oauthState: string,
  integrationId: string,
): Promise<{ redirectUrl: string; connectedAccountId?: string }> {
  try {
    const client = getClient(apiKey);
    const webUrl = process.env.WEB_URL ?? "http://localhost:5173";
    const callbackUrl = `${webUrl}/workspace/oauth-callback/${integrationId}`;

    const session = await client.create(`nexu_${nexuUserId}`, {
      manageConnections: false,
    });

    const connectionRequest = await session.authorize(toolkitSlug, {
      callbackUrl,
    });

    return {
      redirectUrl: connectionRequest.redirectUrl as string,
    };
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(502, {
      message: "Failed to initialize connection with provider",
    });
  }
}

export async function checkOAuthStatus(
  apiKey: string,
  nexuUserId: string,
  toolkitSlug: string,
): Promise<{ status: string; connectedAccountId?: string }> {
  try {
    const client = getClient(apiKey);
    const session = await client.create(`nexu_${nexuUserId}`, {
      manageConnections: false,
    });
    const toolkits = await session.toolkits();
    const matched = toolkits.items.find(
      (t: { slug: string }) => t.slug === toolkitSlug,
    );
    if (!matched) {
      return { status: "PENDING" };
    }
    const connectedAccount = (
      matched as { connection?: { connectedAccount?: { id?: string } } }
    ).connection?.connectedAccount;
    if (connectedAccount?.id) {
      return { status: "ACTIVE", connectedAccountId: connectedAccount.id };
    }
    return { status: "PENDING" };
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(502, {
      message: "Failed to check provider connection status",
    });
  }
}

export async function executeAction(
  apiKey: string,
  connectedAccountId: string,
  nexuUserId: string,
  action: string,
  params: Record<string, unknown>,
): Promise<{ data: unknown; error: string | null; successful: boolean }> {
  const client = getClient(apiKey);

  // Resolve the tool's version (required by Composio for manual execution)
  let version: string | undefined;
  try {
    const toolMeta = await client.tools.getRawComposioToolBySlug(action);
    version = (toolMeta as Record<string, unknown>).version as
      | string
      | undefined;
  } catch {
    // Tool not found in Composio — return descriptive error
    return {
      data: null,
      error: `Action "${action}" not found in Composio. Check the action slug is correct.`,
      successful: false,
    };
  }

  const result = await client.tools.execute(action, {
    connectedAccountId,
    userId: `nexu_${nexuUserId}`,
    arguments: params,
    version,
  });
  return {
    data: result.data ?? null,
    error: result.error ?? null,
    successful: result.successful ?? false,
  };
}

export async function revokeConnection(
  _composioAccountId: string,
): Promise<void> {
  // Composio SDK revocation — clear local state; Composio tokens expire naturally
}

export function maskCredential(value: string): string {
  if (value.length === 0) return "";
  if (value.length <= 4) return value;
  if (value.length < 8) {
    return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
  }
  return `${value.slice(0, 4)}..${value.slice(-4)}`;
}

export function validateCredentialFields(
  authFields: Array<{ key: string; label: string; type: string }>,
  credentials: Record<string, string>,
): void {
  const requiredKeys = new Set(authFields.map((f) => f.key));
  const providedKeys = new Set(Object.keys(credentials));

  for (const field of authFields) {
    if (!providedKeys.has(field.key)) {
      throw new HTTPException(400, {
        message: `Missing required field: ${field.key}`,
      });
    }
    const fieldValue = credentials[field.key];
    if (!fieldValue || fieldValue.trim() === "") {
      throw new HTTPException(400, {
        message: `Field cannot be empty: ${field.key}`,
      });
    }
  }

  for (const key of providedKeys) {
    if (!requiredKeys.has(key)) {
      throw new HTTPException(400, {
        message: `Unknown field: ${key}`,
      });
    }
  }
}
