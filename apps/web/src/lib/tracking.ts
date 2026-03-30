import * as amplitude from "@amplitude/unified";
import { Identify } from "@amplitude/unified";

export type AnalyticsAuthSource = "welcome_page" | "settings";
export type AnalyticsChannel =
  | "wechat"
  | "feishu"
  | "slack"
  | "discord"
  | "telegram"
  | "whatsapp";
export type AnalyticsSidebarTarget =
  | "home"
  | "conversations"
  | "skills"
  | "settings";
export type AnalyticsGitHubSource = "sidebar" | "home_card" | "settings";
export type AnalyticsSkillSource = "builtin" | "explore" | "custom";

export function track(
  event: string,
  properties?: Record<string, unknown>,
): void {
  amplitude.track(event, properties);
}

export function identify(properties: Record<string, unknown>): void {
  const id = new Identify();
  for (const [key, value] of Object.entries(properties)) {
    id.set(key, value as string);
  }
  amplitude.identify(id);
}

export function setUserId(userId: string): void {
  amplitude.setUserId(userId);
}

export function normalizeAuthSource(
  source: string | null | undefined,
): AnalyticsAuthSource | null {
  if (source === "settings") {
    return "settings";
  }
  if (!source || source === "Landing" || source === "welcome_page") {
    return "welcome_page";
  }
  return null;
}

export function normalizeChannel(
  channel: string | null | undefined,
): AnalyticsChannel | null {
  if (channel === "openclaw-weixin" || channel === "wechat") {
    return "wechat";
  }
  if (
    channel === "feishu" ||
    channel === "slack" ||
    channel === "discord" ||
    channel === "telegram" ||
    channel === "whatsapp"
  ) {
    return channel;
  }
  return null;
}

export function mapInstalledSkillSource(
  source: "curated" | "managed" | "custom" | "workspace" | "user",
): AnalyticsSkillSource {
  if (source === "curated" || source === "managed") {
    return "builtin";
  }
  return "custom";
}
