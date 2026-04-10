import posthog, {
  type PostHogConfig,
  type Properties,
  type Property,
} from "posthog-js";

export type AnalyticsAuthSource = "welcome_page" | "settings" | "home";
export type AnalyticsChannel =
  | "qqbot"
  | "dingtalk"
  | "wecom"
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

type AnalyticsInitOptions = {
  apiKey: string;
  apiHost?: string;
  environment: string;
  appName?: string;
  appVersion?: string;
};

let analyticsInitialized = false;
let currentUserId: string | null = null;
let persistentSuperProperties: Properties | null = null;
let currentPersonPropertiesKey: string | null = null;
let currentIdentifyKey: string | null = null;

export const ANALYTICS_PREFERENCE_STORAGE_KEY =
  "nexu_desktop_analytics_enabled";

function buildPersonPropertiesKey(
  properties: Properties | undefined,
): string | null {
  if (!properties) {
    return null;
  }

  return JSON.stringify(
    Object.entries(properties).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAnalyticsProperty(value: unknown): Property | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    const normalized = value.flatMap((item) => {
      const property = toAnalyticsProperty(item);
      return property === undefined ? [] : [property];
    });
    return normalized;
  }

  if (isPlainObject(value)) {
    const normalized: Properties = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const property = toAnalyticsProperty(nestedValue);
      if (property !== undefined) {
        normalized[key] = property;
      }
    }
    return normalized;
  }

  return undefined;
}

function normalizeProperties(
  properties?: Record<string, unknown>,
): Properties | undefined {
  if (!properties) {
    return undefined;
  }

  const normalized: Properties = {};
  for (const [key, value] of Object.entries(properties)) {
    const property = toAnalyticsProperty(value);
    if (property !== undefined) {
      normalized[key] = property;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function initializeAnalytics({
  apiKey,
  apiHost,
  environment,
  appName,
  appVersion,
}: AnalyticsInitOptions): void {
  if (analyticsInitialized || apiKey.trim().length === 0) {
    return;
  }

  persistentSuperProperties = normalizeProperties({
    environment,
    appName,
    appVersion,
  }) ?? { environment };

  const config: Partial<PostHogConfig> = {
    disable_session_recording: false,
    loaded: (client) => {
      if (persistentSuperProperties) {
        client.register(persistentSuperProperties);
      }
    },
  };

  if (apiHost) {
    config.api_host = apiHost;
  }

  posthog.init(apiKey, config);
  analyticsInitialized = true;
}

export function track(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!analyticsInitialized) {
    return;
  }

  posthog.capture(event, normalizeProperties(properties));
}

export function identify(properties: Record<string, unknown>): void {
  if (!analyticsInitialized) {
    return;
  }

  const normalized = normalizeProperties(properties);
  if (!normalized) {
    return;
  }

  const nextPersonPropertiesKey = buildPersonPropertiesKey(normalized);
  if (currentPersonPropertiesKey === nextPersonPropertiesKey) {
    return;
  }

  posthog.setPersonProperties(normalized);
  currentPersonPropertiesKey = nextPersonPropertiesKey;
}

export function identifyAuthenticatedUser(
  userId: string,
  properties?: Record<string, unknown>,
): void {
  if (!analyticsInitialized || userId.trim().length === 0) {
    return;
  }

  const normalizedProperties = normalizeProperties(properties);
  const nextIdentifyKey = JSON.stringify([
    userId,
    buildPersonPropertiesKey(normalizedProperties),
  ]);

  if (currentIdentifyKey === nextIdentifyKey) {
    return;
  }

  if (currentUserId && currentUserId !== userId) {
    posthog.reset();
    if (persistentSuperProperties) {
      posthog.register(persistentSuperProperties);
    }
    currentPersonPropertiesKey = null;
    currentIdentifyKey = null;
  }

  posthog.identify(userId, normalizedProperties);
  currentUserId = userId;
  currentIdentifyKey = nextIdentifyKey;
}

export function resetAnalytics(): void {
  currentUserId = null;
  currentPersonPropertiesKey = null;
  currentIdentifyKey = null;

  if (!analyticsInitialized) {
    return;
  }

  posthog.reset();
  if (persistentSuperProperties) {
    posthog.register(persistentSuperProperties);
  }
}

export function disableAnalytics(): void {
  currentUserId = null;
  currentPersonPropertiesKey = null;
  currentIdentifyKey = null;

  if (analyticsInitialized) {
    posthog.reset();
  }

  analyticsInitialized = false;
}

export function normalizeAuthSource(
  source: string | null | undefined,
): AnalyticsAuthSource | null {
  if (source === "settings") {
    return "settings";
  }
  if (source === "home") {
    return "home";
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
    channel === "qqbot" ||
    channel === "dingtalk" ||
    channel === "wecom" ||
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
