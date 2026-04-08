import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionResponse } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { logger } from "../lib/logger.js";
import { proxyFetch } from "../lib/proxy-fetch.js";
import type { SessionsRuntime } from "../runtime/sessions-runtime.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";

type AnalyticsChannel =
  | "wechat"
  | "feishu"
  | "slack"
  | "discord"
  | "telegram"
  | "whatsapp";
type AnalyticsSkillSource = "builtin" | "explore" | "custom" | "chat";
type InternalSkillSource = "curated" | "managed" | "custom";

type AnalyticsState = {
  sessionStartSent: boolean;
  sentUserMessageIds: string[];
  sentSkillUseIds: string[];
};

type TranscriptEntry = {
  type?: string;
  id?: string;
  timestamp?: string;
  provider?: string;
  modelId?: string;
  customType?: string;
  data?: Record<string, unknown>;
  message?: {
    role?: string;
    timestamp?: number;
    provider?: string;
    content?: unknown;
  };
};

type AnalyticsMessageState = "Success" | "false";

type UserMessageCandidate = {
  id: string;
  timestampMs: number;
  createdAt: string | null;
  providerName: string | null;
  channel: AnalyticsChannel;
  state: AnalyticsMessageState;
};

type SkillUseCandidate = {
  id: string;
  timestampMs: number;
  providerName: string | null;
  channel: AnalyticsChannel;
  skillName: string;
  skillSource: AnalyticsSkillSource;
};

type ResolvedSkillInfo = {
  name: string;
  filePath: string | null;
  source: string | null;
};

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

const EMPTY_ANALYTICS_STATE: AnalyticsState = {
  sessionStartSent: false,
  sentUserMessageIds: [],
  sentSkillUseIds: [],
};

function toAnalyticsChannel(
  channelType: string | null,
): AnalyticsChannel | null {
  if (channelType === "openclaw-weixin" || channelType === "wechat") {
    return "wechat";
  }
  if (
    channelType === "feishu" ||
    channelType === "slack" ||
    channelType === "discord" ||
    channelType === "telegram" ||
    channelType === "whatsapp"
  ) {
    return channelType;
  }
  return null;
}

function toAnalyticsSkillSource(
  source: InternalSkillSource | null,
): AnalyticsSkillSource {
  if (source === "managed") {
    return "explore";
  }
  if (source === "custom") {
    return "custom";
  }
  return "builtin";
}

function parseTimestampMs(
  createdAt: string | null | undefined,
  fallbackTimestamp: number | null | undefined,
): number {
  const createdAtMs = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (Number.isFinite(createdAtMs)) {
    return createdAtMs;
  }
  if (typeof fallbackTimestamp === "number") {
    return fallbackTimestamp;
  }
  return Date.now();
}

function getSessionFilePath(session: SessionResponse): string | null {
  const metadata =
    (session.metadata as Record<string, unknown> | null | undefined) ?? null;
  const filePath = metadata?.path;
  return typeof filePath === "string" ? filePath : null;
}

function getToolCalls(
  content: unknown,
): Array<{ id: string | null; name: string }> {
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((part) => {
    if (typeof part !== "object" || part === null) {
      return [];
    }

    const type = "type" in part ? part.type : null;
    const name = "name" in part ? part.name : null;
    const id = "id" in part ? part.id : null;
    if (type !== "toolCall" || typeof name !== "string") {
      return [];
    }

    return [
      {
        id: typeof id === "string" ? id : null,
        name,
      },
    ];
  });
}

export class AnalyticsService {
  private state: AnalyticsState = EMPTY_ANALYTICS_STATE;
  private readonly sentUserMessageIds = new Set<string>();
  private readonly sentSkillUseIds = new Set<string>();
  private stateLoaded = false;

  constructor(
    private readonly env: ControllerEnv,
    private readonly configStore: NexuConfigStore,
    private readonly sessionsRuntime: SessionsRuntime,
  ) {}

  async poll(): Promise<void> {
    if (!this.env.posthogApiKey) {
      return;
    }

    await this.ensureStateLoaded();
    const profile = await this.configStore.getLocalProfile();
    const sessions = await this.sessionsRuntime.listSessions();
    const skillLedger = await this.readSkillLedgerSources();
    let stateChanged = false;
    let firstSessionCandidate: UserMessageCandidate | null = null;

    for (const session of sessions) {
      const channel = toAnalyticsChannel(session.channelType);
      const filePath = getSessionFilePath(session);
      if (!channel || !filePath) {
        continue;
      }

      const [entries, resolvedSkills] = await Promise.all([
        this.readTranscript(filePath),
        this.readResolvedSkills(filePath),
      ]);
      const { userMessages, skillUses } = this.analyzeSession({
        sessionId: session.id,
        entries,
        channel,
        resolvedSkills,
        skillLedger,
      });

      if (!this.state.sessionStartSent) {
        const sessionFirstMessage = userMessages[0];
        if (
          sessionFirstMessage &&
          (!firstSessionCandidate ||
            sessionFirstMessage.timestampMs < firstSessionCandidate.timestampMs)
        ) {
          firstSessionCandidate = sessionFirstMessage;
        }
      }

      for (const userMessage of userMessages) {
        if (this.sentUserMessageIds.has(userMessage.id)) {
          continue;
        }
        if (!userMessage.providerName) {
          continue;
        }

        await this.sendAnalyticsEvent(
          profile.id,
          "user_message_sent",
          {
            channel: userMessage.channel,
            model_provider: userMessage.providerName,
            state: userMessage.state,
          },
          userMessage.timestampMs,
        );
        this.sentUserMessageIds.add(userMessage.id);
        stateChanged = true;
      }

      for (const skillUse of skillUses) {
        if (this.sentSkillUseIds.has(skillUse.id)) {
          continue;
        }
        if (!skillUse.providerName) {
          continue;
        }

        await this.sendAnalyticsEvent(
          profile.id,
          "skill_use",
          {
            skill_name: skillUse.skillName,
            skill_source: skillUse.skillSource,
            channel: skillUse.channel,
            model_provider: skillUse.providerName,
          },
          skillUse.timestampMs,
        );
        this.sentSkillUseIds.add(skillUse.id);
        stateChanged = true;
      }
    }

    if (!this.state.sessionStartSent && firstSessionCandidate?.providerName) {
      await this.sendAnalyticsEvent(
        profile.id,
        "nexu_first_conversation_start",
        {
          channel: firstSessionCandidate.channel,
          model_provider: firstSessionCandidate.providerName,
        },
        firstSessionCandidate.timestampMs,
      );
      this.state.sessionStartSent = true;
      stateChanged = true;
    }

    if (stateChanged) {
      await this.persistState();
    }
  }

  private async ensureStateLoaded(): Promise<void> {
    if (this.stateLoaded) {
      return;
    }

    try {
      const raw = await readFile(this.env.analyticsStatePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<AnalyticsState>;
      this.state = {
        sessionStartSent: parsed.sessionStartSent === true,
        sentUserMessageIds: Array.isArray(parsed.sentUserMessageIds)
          ? parsed.sentUserMessageIds.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
        sentSkillUseIds: Array.isArray(parsed.sentSkillUseIds)
          ? parsed.sentSkillUseIds.filter(
              (value): value is string => typeof value === "string",
            )
          : [],
      };
    } catch {
      this.state = {
        ...EMPTY_ANALYTICS_STATE,
      };
    }

    for (const id of this.state.sentUserMessageIds) {
      this.sentUserMessageIds.add(id);
    }
    for (const id of this.state.sentSkillUseIds) {
      this.sentSkillUseIds.add(id);
    }
    this.stateLoaded = true;
  }

  private async persistState(): Promise<void> {
    this.state.sentUserMessageIds = Array.from(this.sentUserMessageIds);
    this.state.sentSkillUseIds = Array.from(this.sentSkillUseIds);
    await mkdir(path.dirname(this.env.analyticsStatePath), { recursive: true });
    await writeFile(
      this.env.analyticsStatePath,
      `${JSON.stringify(this.state, null, 2)}\n`,
      "utf8",
    );
  }

  private async readTranscript(filePath: string): Promise<TranscriptEntry[]> {
    try {
      const raw = await readFile(filePath, "utf8");
      return raw
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as TranscriptEntry];
          } catch {
            return [];
          }
        });
    } catch {
      return [];
    }
  }

  private async readResolvedSkills(
    sessionFilePath: string,
  ): Promise<Map<string, ResolvedSkillInfo>> {
    const resolved = new Map<string, ResolvedSkillInfo>();
    const sessionsJsonPath = path.join(
      path.dirname(sessionFilePath),
      "sessions.json",
    );

    try {
      const raw = await readFile(sessionsJsonPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const value of Object.values(parsed)) {
        if (typeof value !== "object" || value === null) {
          continue;
        }
        const snapshot =
          "skillsSnapshot" in value ? value.skillsSnapshot : null;
        if (typeof snapshot !== "object" || snapshot === null) {
          continue;
        }
        const resolvedSkills =
          "resolvedSkills" in snapshot ? snapshot.resolvedSkills : null;
        if (!Array.isArray(resolvedSkills)) {
          continue;
        }
        for (const skill of resolvedSkills) {
          if (typeof skill !== "object" || skill === null) {
            continue;
          }
          const name = "name" in skill ? skill.name : null;
          if (typeof name !== "string") {
            continue;
          }
          resolved.set(name, {
            name,
            filePath:
              "filePath" in skill && typeof skill.filePath === "string"
                ? skill.filePath
                : null,
            source:
              "source" in skill && typeof skill.source === "string"
                ? skill.source
                : null,
          });
        }
      }
    } catch {
      return resolved;
    }

    return resolved;
  }

  private async readSkillLedgerSources(): Promise<
    Map<string, InternalSkillSource>
  > {
    const ledger = new Map<string, InternalSkillSource>();

    try {
      const raw = await readFile(this.env.skillDbPath, "utf8");
      const parsed = JSON.parse(raw) as {
        skills?: Array<Record<string, unknown>>;
      };
      for (const skill of parsed.skills ?? []) {
        const slug = skill.slug;
        const source = skill.source;
        const status = skill.status;
        if (
          typeof slug === "string" &&
          (source === "curated" ||
            source === "managed" ||
            source === "custom") &&
          status === "installed"
        ) {
          ledger.set(slug, source);
        }
      }
    } catch {
      return ledger;
    }

    return ledger;
  }

  private analyzeSession(params: {
    sessionId: string;
    entries: TranscriptEntry[];
    channel: AnalyticsChannel;
    resolvedSkills: Map<string, ResolvedSkillInfo>;
    skillLedger: Map<string, InternalSkillSource>;
  }): {
    userMessages: UserMessageCandidate[];
    skillUses: SkillUseCandidate[];
  } {
    const userMessages: UserMessageCandidate[] = [];
    const skillUses: SkillUseCandidate[] = [];
    const pendingUserIndexes: number[] = [];
    let currentProvider: string | null = null;

    for (const entry of params.entries) {
      if (entry.type === "model_change" && typeof entry.provider === "string") {
        currentProvider = entry.provider;
        continue;
      }

      if (
        entry.type === "custom" &&
        entry.customType === "model-snapshot" &&
        typeof entry.data?.provider === "string"
      ) {
        currentProvider = entry.data.provider;
        continue;
      }

      // Resolve any pending user messages as failed when openclaw reports a
      // prompt error. Each error entry's parentId points back to the user
      // message that triggered it; the cheapest correct interpretation is
      // "any user message that hasn't yet been answered when this error
      // arrives is a failure".
      if (
        entry.type === "custom" &&
        entry.customType === "openclaw:prompt-error"
      ) {
        const errorProvider =
          typeof entry.data?.provider === "string" ? entry.data.provider : null;
        if (errorProvider) {
          currentProvider = errorProvider;
        }
        for (const index of pendingUserIndexes) {
          const message = userMessages[index];
          if (!message) {
            continue;
          }
          userMessages[index] = {
            id: message.id,
            timestampMs: message.timestampMs,
            createdAt: message.createdAt,
            providerName: errorProvider ?? message.providerName,
            channel: message.channel,
            state: "false",
          };
        }
        pendingUserIndexes.length = 0;
        continue;
      }

      if (entry.type !== "message" || !entry.message) {
        continue;
      }

      if (entry.message.role === "user") {
        const id = typeof entry.id === "string" ? entry.id : null;
        if (!id) {
          continue;
        }
        userMessages.push({
          id: `${params.sessionId}:${id}`,
          timestampMs: parseTimestampMs(
            entry.timestamp ?? null,
            entry.message.timestamp ?? null,
          ),
          createdAt: entry.timestamp ?? null,
          providerName: currentProvider,
          channel: params.channel,
          state: "Success",
        });
        pendingUserIndexes.push(userMessages.length - 1);
        continue;
      }

      if (entry.message.role !== "assistant") {
        continue;
      }

      const providerName =
        typeof entry.message.provider === "string"
          ? entry.message.provider
          : currentProvider;
      if (providerName) {
        currentProvider = providerName;
        for (const index of pendingUserIndexes) {
          const message = userMessages[index];
          if (!message) {
            continue;
          }
          userMessages[index] = {
            id: message.id,
            timestampMs: message.timestampMs,
            createdAt: message.createdAt,
            providerName,
            channel: message.channel,
            state: message.state,
          };
        }
      }
      pendingUserIndexes.length = 0;

      const toolCalls = getToolCalls(entry.message.content);
      toolCalls.forEach((toolCall, index) => {
        const skillSource = this.resolveSkillSource(
          toolCall.name,
          params.resolvedSkills,
          params.skillLedger,
        );
        skillUses.push({
          id: toolCall.id
            ? `${params.sessionId}:${toolCall.id}`
            : `${params.sessionId}:${entry.id ?? "assistant"}:${toolCall.name}:${String(index)}`,
          timestampMs: parseTimestampMs(
            entry.timestamp ?? null,
            entry.message?.timestamp ?? null,
          ),
          providerName,
          channel: params.channel,
          skillName: toolCall.name,
          skillSource,
        });
      });
    }

    return { userMessages, skillUses };
  }

  private resolveSkillSource(
    skillName: string,
    resolvedSkills: Map<string, ResolvedSkillInfo>,
    skillLedger: Map<string, InternalSkillSource>,
  ): AnalyticsSkillSource {
    const ledgerSource = skillLedger.get(skillName) ?? null;
    if (ledgerSource) {
      return toAnalyticsSkillSource(ledgerSource);
    }

    const resolvedSkill = resolvedSkills.get(skillName);
    if (!resolvedSkill) {
      return "builtin";
    }

    if (
      resolvedSkill.source === "openclaw-bundled" ||
      resolvedSkill.source === "openclaw-extra"
    ) {
      return "builtin";
    }

    if (resolvedSkill.filePath?.includes("/openclaw/skills/")) {
      return "builtin";
    }
    if (resolvedSkill.filePath?.includes("/extensions/")) {
      return "builtin";
    }

    return "builtin";
  }

  private getPosthogCaptureUrl(): string | null {
    const host = this.env.posthogHost?.trim() || DEFAULT_POSTHOG_HOST;
    if (!host) {
      return null;
    }
    return `${host.replace(/\/+$/, "")}/i/v0/e/`;
  }

  private async sendAnalyticsEvent(
    distinctId: string,
    eventType: string,
    eventProperties: Record<string, unknown>,
    timestampMs: number,
  ): Promise<void> {
    const captureUrl = this.getPosthogCaptureUrl();
    if (!captureUrl || !this.env.posthogApiKey) {
      return;
    }

    try {
      const response = await proxyFetch(captureUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          api_key: this.env.posthogApiKey,
          distinct_id: distinctId,
          event: eventType,
          properties: {
            ...eventProperties,
          },
          timestamp: new Date(timestampMs).toISOString(),
        }),
      });

      if (!response.ok) {
        logger.warn(
          {
            eventType,
            status: response.status,
          },
          "analytics_event_send_failed",
        );
      }
    } catch (error) {
      logger.warn(
        {
          eventType,
          error: error instanceof Error ? error.message : String(error),
        },
        "analytics_event_send_failed",
      );
    }
  }
}
