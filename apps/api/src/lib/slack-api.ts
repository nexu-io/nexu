import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { channelCredentials } from "../db/schema/index.js";
import { decrypt } from "./crypto.js";

/**
 * Retrieve and decrypt the botToken for a given bot channel.
 */
export async function getDecryptedBotToken(
  botChannelId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ encryptedValue: channelCredentials.encryptedValue })
    .from(channelCredentials)
    .where(
      and(
        eq(channelCredentials.botChannelId, botChannelId),
        eq(channelCredentials.credentialType, "botToken"),
      ),
    );
  if (!row) return null;
  return decrypt(row.encryptedValue);
}

/**
 * Send a message via chat.postMessage (visible to everyone in the channel).
 */
export async function sendSlackMessage(params: {
  botToken: string;
  channel: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
}): Promise<{ ok: boolean; error?: string; ts?: string }> {
  const body: Record<string, unknown> = {
    channel: params.channel,
    text: params.text,
    blocks: params.blocks,
  };
  if (params.threadTs) body.thread_ts = params.threadTs;

  const resp = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return (await resp.json()) as { ok: boolean; error?: string; ts?: string };
}

/**
 * Send an ephemeral message via chat.postEphemeral (only visible to a specific user).
 */
export async function sendSlackEphemeral(params: {
  botToken: string;
  channel: string;
  user: string;
  text: string;
  blocks?: unknown[];
  threadTs?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, unknown> = {
    channel: params.channel,
    user: params.user,
    text: params.text,
    blocks: params.blocks,
  };
  if (params.threadTs) body.thread_ts = params.threadTs;

  const resp = await fetch("https://slack.com/api/chat.postEphemeral", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return (await resp.json()) as { ok: boolean; error?: string };
}

/**
 * Open a DM channel with a user via conversations.open.
 */
export async function openSlackDm(params: {
  botToken: string;
  userId: string;
}): Promise<{ ok: boolean; channel?: { id: string }; error?: string }> {
  const resp = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      users: params.userId,
      return_im: true,
    }),
  });
  return (await resp.json()) as {
    ok: boolean;
    channel?: { id: string };
    error?: string;
  };
}
