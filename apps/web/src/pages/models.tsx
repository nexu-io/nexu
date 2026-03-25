import { GitHubStarCta } from "@/components/github-star-cta";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ModelLogo, ProviderLogo } from "@/components/provider-logo";
import { useGitHubStars } from "@/hooks/use-github-stars";
import { openLocalFolderUrl, pathToFileUrl } from "@/lib/desktop-links";
import { track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { selectPreferredModel } from "@nexu/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Camera,
  Check,
  ExternalLink,
  FolderOpen,
  Loader2,
  LogIn,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  deleteApiV1ProvidersByProviderId,
  deleteApiV1ProvidersMinimaxOauthLogin,
  getApiInternalDesktopCloudStatus,
  getApiInternalDesktopDefaultModel,
  getApiInternalDesktopReady,
  getApiV1Me,
  getApiV1Models,
  getApiV1Providers,
  getApiV1ProvidersByProviderIdOauthProviderStatus,
  getApiV1ProvidersByProviderIdOauthStatus,
  getApiV1ProvidersMinimaxOauthStatus,
  patchApiV1Me,
  postApiInternalDesktopCloudConnect,
  postApiInternalDesktopCloudDisconnect,
  postApiInternalDesktopCloudRefresh,
  postApiV1ProvidersByProviderIdOauthDisconnect,
  postApiV1ProvidersByProviderIdOauthStart,
  postApiV1ProvidersByProviderIdVerify,
  postApiV1ProvidersMinimaxOauthLogin,
  putApiInternalDesktopDefaultModel,
  putApiV1ProvidersByProviderId,
} from "../../lib/api/sdk.gen";
import { markSetupComplete } from "./welcome";

// ── Types ──────────────────────────────────────────────────────

interface ProviderModel {
  id: string;
  name: string;
  description?: string;
}

interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  managed: boolean; // true = platform provides API key
  apiDocsUrl?: string;
  models: ProviderModel[];
}

interface DbProvider {
  id: string;
  providerId: string;
  displayName: string;
  enabled: boolean;
  baseUrl: string | null;
  authMode?: "apiKey" | "oauth";
  hasApiKey: boolean;
  hasOauthCredential?: boolean;
  oauthRegion?: "global" | "cn" | null;
  oauthEmail?: string | null;
  modelsJson: string;
}

type MiniMaxDesktopOauthStatus = {
  connected: boolean;
  inProgress: boolean;
  region?: "global" | "cn" | null;
  error?: string | null;
};

type MiniMaxDesktopOauthStartResult = MiniMaxDesktopOauthStatus & {
  started: boolean;
  browserUrl?: string;
};

type MiniMaxDesktopOauthCancelResult = MiniMaxDesktopOauthStatus & {
  cancelled: boolean;
};

function getDefaultMiniMaxAuthMode(
  providerId: ByokProviderId,
  dbProvider?: DbProvider,
): "apiKey" | "oauth" {
  if (dbProvider?.authMode) {
    return dbProvider.authMode;
  }
  if (dbProvider?.hasApiKey) {
    return "apiKey";
  }
  if (dbProvider?.hasOauthCredential) {
    return "oauth";
  }

  return providerId === "minimax" ? "oauth" : "apiKey";
}

function setMiniMaxOauthErrorInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  error: Error,
) {
  queryClient.setQueryData<MiniMaxDesktopOauthStatus>(
    ["minimax-oauth-status"],
    (previous) => ({
      connected: previous?.connected ?? false,
      inProgress: false,
      region: previous?.region ?? null,
      error: error.message,
    }),
  );
}

type ModelsHostInvokeBridge = {
  invoke: {
    (
      channel: "desktop:get-minimax-oauth-status",
      payload: undefined,
    ): Promise<MiniMaxDesktopOauthStatus>;
    (
      channel: "desktop:start-minimax-oauth",
      payload: { region: "global" | "cn" },
    ): Promise<MiniMaxDesktopOauthStartResult>;
    (
      channel: "desktop:cancel-minimax-oauth",
      payload: undefined,
    ): Promise<MiniMaxDesktopOauthCancelResult>;
    (
      channel: "shell:open-external",
      payload: { url: string },
    ): Promise<{ ok: boolean }>;
  };
};

function getModelsHostInvokeBridge(): ModelsHostInvokeBridge | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (window as Window & { nexuHost?: unknown }).nexuHost;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const invoke = Reflect.get(candidate, "invoke");
  if (typeof invoke !== "function") {
    return null;
  }

  return {
    invoke: ((channel: string, payload: unknown) =>
      invoke.call(
        candidate,
        channel as never,
        payload as never,
      )) as ModelsHostInvokeBridge["invoke"],
  };
}

function getModelDisplayLabel(modelId: string): string {
  return modelId.includes("/")
    ? modelId.split("/").slice(1).join("/")
    : modelId;
}

function isModelSelected(modelId: string, currentModelId: string): boolean {
  return (
    modelId === currentModelId ||
    getModelDisplayLabel(currentModelId) === modelId
  );
}

function getProviderIdFromModelId(
  models: Array<{ id: string; provider: string }>,
  modelId: string,
): string | null {
  const matched = models.find((model) => model.id === modelId);
  if (matched) {
    return matched.provider;
  }
  if (!modelId.includes("/")) {
    return null;
  }
  const [provider] = modelId.split("/");
  return provider || null;
}

type SettingsTab = "general" | "providers";

function isSettingsTab(value: string | null): value is SettingsTab {
  return value === "general" || value === "providers";
}

// ── Provider metadata ─────────────────────────────────────────

const PROVIDER_META: Record<
  string,
  {
    name: string;
    descriptionKey: string;
    apiDocsUrl?: string;
    apiKeyPlaceholder?: string;
    defaultProxyUrl?: string;
  }
> = {
  nexu: {
    name: "nexu Official",
    descriptionKey: "models.provider.nexu.description",
  },
  anthropic: {
    name: "Anthropic",
    descriptionKey: "models.provider.anthropic.description",
    apiDocsUrl: "https://console.anthropic.com/settings/keys",
    apiKeyPlaceholder: "sk-ant-api03-...",
    defaultProxyUrl: "https://api.anthropic.com",
  },
  openai: {
    name: "OpenAI",
    descriptionKey: "models.provider.openai.description",
    apiDocsUrl: "https://platform.openai.com/api-keys",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.openai.com/v1",
  },
  google: {
    name: "Google AI",
    descriptionKey: "models.provider.google.description",
    apiDocsUrl: "https://aistudio.google.com/app/apikey",
    apiKeyPlaceholder: "AIza...",
    defaultProxyUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  siliconflow: {
    name: "SiliconFlow",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://cloud.siliconflow.cn/account/ak",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.siliconflow.com/v1",
  },
  ppio: {
    name: "PPIO",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://www.ppinfra.com/",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.ppinfra.com/v3/openai",
  },
  openrouter: {
    name: "OpenRouter",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://openrouter.ai/settings/keys",
    apiKeyPlaceholder: "sk-or-...",
    defaultProxyUrl: "https://openrouter.ai/api/v1",
  },
  minimax: {
    name: "MiniMax",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl:
      "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.minimax.io/anthropic",
  },
  kimi: {
    name: "Kimi",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://platform.moonshot.cn/console/api-keys",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.moonshot.cn/v1",
  },
  glm: {
    name: "GLM",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    apiKeyPlaceholder: "eyJ...",
    defaultProxyUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
  moonshot: {
    name: "Kimi",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://platform.moonshot.cn/console/api-keys",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.moonshot.cn/v1",
  },
  zai: {
    name: "GLM",
    descriptionKey: "models.provider.openaiCompatible.description",
    apiDocsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    apiKeyPlaceholder: "eyJ...",
    defaultProxyUrl: "https://open.bigmodel.cn/api/paas/v4",
  },
};

// Well-known models per provider (shown when no verify result yet)
const DEFAULT_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-opus-4-1-20250805",
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-3-5-haiku-20241022",
  ],
  openai: ["gpt-5.4", "gpt-5.1", "gpt-5-mini", "o4-mini"],
  google: [
    "gemini-3-pro",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ],
  siliconflow: [
    "deepseek-ai/DeepSeek-R1",
    "deepseek-ai/DeepSeek-V3",
    "Qwen/Qwen3-14B",
    "moonshotai/Kimi-K2-Instruct",
  ],
  ppio: [
    "deepseek/deepseek-v3-turbo",
    "deepseek/deepseek-v3/community",
    "deepseek/deepseek-r1-0528",
    "deepseek/deepseek-r1/community",
  ],
  openrouter: ["auto", "openrouter/hunter-alpha", "openrouter/healer-alpha"],
  minimax: [
    "MiniMax-M2.7",
    "MiniMax-M2.7-highspeed",
    "MiniMax-M2.5",
    "MiniMax-M2.5-highspeed",
    "MiniMax-M2.1",
    "MiniMax-M2.1-highspeed",
    "MiniMax-M2",
  ],
  kimi: ["kimi-k2.5"],
  glm: ["glm-5", "glm-5-turbo", "glm-4.7", "glm-4.7-flash"],
  moonshot: ["kimi-k2.5"],
  zai: ["glm-5", "glm-4.7", "glm-4.7-flash", "glm-4.7-flashx"],
};

const ZAI_CODING_PLAN_URLS: Record<string, string> = {
  global: "https://api.z.ai/api/coding/paas/v4",
  cn: "https://open.bigmodel.cn/api/coding/paas/v4",
};
const ZAI_CODING_PLAN_MODELS = [
  "glm-5",
  "glm-4.7",
  "glm-4.7-flash",
  "glm-4.7-flashx",
];

function buildProviders(
  apiModels: Array<{
    id: string;
    name: string;
    provider: string;
    isDefault?: boolean;
    description?: string;
  }>,
): ProviderConfig[] {
  // Group models by provider
  const grouped = new Map<string, ProviderModel[]>();
  for (const m of apiModels) {
    const list = grouped.get(m.provider) ?? [];
    list.push({
      id: m.id,
      name: m.name,
      description: m.description,
    });
    grouped.set(m.provider, list);
  }

  return Array.from(grouped.entries()).map(([providerId, models]) => {
    const meta = PROVIDER_META[providerId] ?? {
      name: providerId,
      descriptionKey: "",
    };
    return {
      id: providerId,
      name: meta.name,
      description: meta.descriptionKey,
      managed: providerId === "nexu",
      apiDocsUrl: meta.apiDocsUrl,
      models,
    };
  });
}

// ── API helpers ───────────────────────────────────────────────

async function fetchProviders(): Promise<DbProvider[]> {
  const { data } = await getApiV1Providers();
  return data?.providers ?? [];
}

async function saveProvider(
  providerId: ByokProviderId,
  body: {
    apiKey?: string;
    baseUrl?: string | null;
    enabled?: boolean;
    displayName?: string;
    authMode?: "apiKey" | "oauth";
    modelsJson?: string;
  },
): Promise<DbProvider> {
  const { data, error } = await putApiV1ProvidersByProviderId({
    path: { providerId },
    body: { ...body, baseUrl: body.baseUrl ?? undefined },
  });
  if (error || !data) throw new Error("Failed to save provider");
  return data.provider as DbProvider;
}

async function deleteProvider(providerId: ByokProviderId): Promise<void> {
  const { error } = await deleteApiV1ProvidersByProviderId({
    path: { providerId },
  });
  if (error) throw new Error("Failed to delete provider");
}

async function verifyApiKey(
  providerId: ByokProviderId,
  apiKey: string,
  baseUrl?: string,
): Promise<{ valid: boolean; models?: string[]; error?: string }> {
  const { data, error } = await postApiV1ProvidersByProviderIdVerify({
    path: { providerId },
    body: { apiKey, baseUrl },
  });
  if (error || !data) throw new Error("Verify request failed");
  return data;
}

// ── BYOK provider sidebar entries ─────────────────────────────
// Always show these four as configurable, even if no key set yet

const BYOK_PROVIDER_IDS = [
  "anthropic",
  "openai",
  "google",
  "siliconflow",
  "ppio",
  "openrouter",
  "minimax",
  "kimi",
  "glm",
] as const;

type ByokProviderId = (typeof BYOK_PROVIDER_IDS)[number];

// ── Component ──────────────────────────────────────────────────

function _GeneralSettings() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  const [draftName, setDraftName] = useState("");
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await getApiV1Me();
      return data;
    },
  });

  useEffect(() => {
    setDraftName(profile?.name ?? "");
    setDraftImage(profile?.image ?? null);
  }, [profile?.image, profile?.name]);

  useEffect(() => {
    if (isEditingName) {
      nameInputRef.current?.focus();
    }
  }, [isEditingName]);

  const saveProfile = useMutation({
    mutationFn: async (input: { name: string; image: string | null }) => {
      const { data, error } = await patchApiV1Me({
        body: {
          name: input.name,
          image: input.image,
        },
      });
      if (error) {
        throw new Error("Failed to update profile");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success(t("settings.general.saved"));
      setIsEditingName(false);
    },
    onError: () => {
      toast.error(t("settings.general.saveFailed"));
    },
  });

  const persistProfile = (name: string, image: string | null) => {
    if (!name.trim()) {
      toast.error(t("settings.general.nameRequired"));
      return;
    }

    saveProfile.mutate({ name: name.trim(), image });
  };

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error(t("settings.general.avatarTooLarge"));
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const nextImage =
        typeof reader.result === "string" ? reader.result : null;
      const nextName = (draftName.trim() || profile?.name || "").trim();
      setDraftImage(nextImage);
      persistProfile(nextName, nextImage);
    };
    reader.onerror = () => {
      toast.error(t("settings.general.avatarReadFailed"));
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleSave = () => {
    persistProfile(draftName, draftImage);
  };

  const currentName = draftName.trim() || profile?.name || "User";
  const initials = currentName[0]?.toUpperCase() ?? "U";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="overflow-visible rounded-2xl border border-border bg-surface-1">
        <div className="px-5 pb-1 pt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
            {t("settings.general.account")}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-5 py-3">
          <div className="text-[13px] text-text-primary">
            {t("settings.general.avatar")}
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-lg"
          >
            {draftImage ? (
              <img
                src={draftImage}
                alt={currentName}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-lg bg-surface-3 text-[13px] font-semibold text-text-secondary">
                {initials}
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera size={14} className="text-white" />
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleAvatarChange}
            className="hidden"
          />
        </div>

        <div className="mx-5 border-t border-border-subtle" />

        <div className="flex items-center justify-between gap-4 px-5 py-3">
          <div className="text-[13px] text-text-primary">
            {t("settings.general.fullName")}
          </div>
          {isEditingName ? (
            <div className="flex items-center gap-2">
              <input
                ref={nameInputRef}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleSave();
                  if (event.key === "Escape") {
                    setDraftName(profile?.name ?? "");
                    setIsEditingName(false);
                  }
                }}
                className="w-32 rounded-lg border border-border bg-surface-0 px-3 py-1 text-[13px] text-text-primary outline-none transition focus:ring-2 focus:ring-[var(--color-brand-primary)]/20"
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={saveProfile.isPending}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saveProfile.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Check size={13} />
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingName(true)}
              className="group inline-flex items-center gap-2 text-[13px] text-text-primary transition-colors hover:text-accent"
            >
              <span>{currentName}</span>
              <Pencil
                size={12}
                className="text-text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
              />
            </button>
          )}
        </div>

        <div className="mx-5 border-t border-border-subtle" />

        <div className="px-5 pb-1 pt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
            {t("settings.general.preferences")}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 px-5 py-3 pb-4">
          <div className="text-[13px] text-text-primary">
            {t("settings.general.language")}
          </div>
          <LanguageSwitcher variant="muted" size="xs" />
        </div>
      </div>
    </div>
  );
}

// _CurrentModelSelector removed — model switching now lives inline in each provider's model list

export function ModelsPage() {
  const { t } = useTranslation();
  const { stars: starNexu } = useGitHubStars();
  const isDesktopClient = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Electron"),
    [],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const isSetupMode = searchParams.get("setup") === "1";
  const tabParam = searchParams.get("tab");
  const _settingsTab = isSettingsTab(tabParam)
    ? tabParam
    : isSetupMode
      ? "providers"
      : "general";
  const providerParam = searchParams.get("provider");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    providerParam ?? (isSetupMode ? "anthropic" : null),
  );

  const queryClient = useQueryClient();

  const {
    data: modelsData,
    isLoading: modelsLoading,
    isError: modelsError,
  } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const { data } = await getApiV1Models();
      return data;
    },
  });

  const { data: dbProviders = [] } = useQuery({
    queryKey: ["providers"],
    queryFn: fetchProviders,
  });

  // Current default model
  const { data: defaultModelData } = useQuery({
    queryKey: ["desktop-default-model"],
    queryFn: async () => {
      const { data } = await getApiInternalDesktopDefaultModel();
      return data as { modelId: string | null } | undefined;
    },
  });

  const currentModelId = defaultModelData?.modelId ?? "";
  const models = modelsData?.models ?? [];
  const { data: desktopReadyData } = useQuery({
    queryKey: ["desktop-ready"],
    queryFn: async () => {
      const { data } = await getApiInternalDesktopReady();
      return data;
    },
  });

  const userSwitchRef = useRef(false);
  const updateModel = useMutation({
    mutationFn: async (modelId: string) => {
      userSwitchRef.current = true;
      const toastId = toast.loading(t("models.switchingModel"));
      const { error } = await putApiInternalDesktopDefaultModel({
        body: { modelId },
      });
      if (error) {
        toast.error(t("models.modelSwitchFailed"), { id: toastId });
        throw new Error("Failed to update model");
      }
      toast.success(t("models.modelSwitched"), { id: toastId });
    },
    onSuccess: (_, modelId) => {
      track("workspace_change_model_change", {
        previous_provider_name: getProviderIdFromModelId(
          models,
          currentModelId,
        ),
        previous_model_name: currentModelId || null,
        provider_name: getProviderIdFromModelId(models, modelId),
        model_name: modelId,
      });
      queryClient.invalidateQueries({ queryKey: ["desktop-default-model"] });
    },
  });

  // Detect backend auto-switch (ensureValidDefaultModel) and toast
  const prevModelIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const newId = defaultModelData?.modelId;
    if (newId === undefined) return;
    const prev = prevModelIdRef.current;
    prevModelIdRef.current = newId ?? undefined;
    if (prev === undefined) return; // skip initial load

    if (newId && newId !== prev && !userSwitchRef.current) {
      const matched = models.find((m) => m.id === newId);
      const providerName =
        PROVIDER_META[matched?.provider ?? ""]?.name ?? matched?.provider;
      const label = providerName
        ? `${matched?.name ?? newId} (${providerName})`
        : (matched?.name ?? newId);
      toast.info(t("models.autoSwitched", { model: label }));
    }
    userSwitchRef.current = false;
  }, [defaultModelData?.modelId, models, t]);

  const providers = useMemo(() => buildProviders(models), [models]);

  // Build sidebar items: Nexu first, then BYOK providers
  const sidebarItems = useMemo(() => {
    const items: Array<{
      id: string;
      name: string;
      modelCount: number;
      configured: boolean;
      managed: boolean;
    }> = [];

    // Nexu official — always shown
    const nexuProvider = providers.find((p) => p.id === "nexu");
    items.push({
      id: "nexu",
      name: "nexu Official",
      modelCount: nexuProvider?.models.length ?? 0,
      configured: (nexuProvider?.models.length ?? 0) > 0,
      managed: true,
    });

    // BYOK providers — always listed
    for (const pid of BYOK_PROVIDER_IDS) {
      const meta = PROVIDER_META[pid] ?? { name: pid, description: "" };
      const db = dbProviders.find((p) => p.providerId === pid);
      const modProv = providers.find((p) => p.id === pid);
      items.push({
        id: pid,
        name: meta.name,
        modelCount: modProv?.models.length ?? 0,
        configured:
          (db?.hasApiKey ?? false) || (db?.hasOauthCredential ?? false),
        managed: false,
      });
    }

    return items;
  }, [providers, dbProviders]);

  const activeProvider =
    sidebarItems.find((p) => p.id === selectedProviderId) ??
    sidebarItems[0] ??
    null;

  // Clear setup param once user interacts
  const clearSetupParam = useCallback(() => {
    if (isSetupMode) {
      const next = new URLSearchParams(searchParams);
      next.delete("setup");
      if (!next.get("tab")) {
        next.set("tab", "providers");
      }
      setSearchParams(next, { replace: true });
    }
  }, [isSetupMode, searchParams, setSearchParams]);

  const _changeSettingsTab = useCallback(
    (tab: SettingsTab) => {
      const next = new URLSearchParams(searchParams);
      next.set("tab", tab);
      next.delete("setup");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Auto-select first model after provider save
  const handleAutoSelectModel = useCallback(
    (firstModelId: string) => {
      if (!currentModelId) {
        updateModel.mutate(firstModelId);
      }
    },
    [currentModelId, updateModel],
  );

  const handleOpenWorkspace = useCallback(async () => {
    if (!desktopReadyData?.workspacePath) {
      toast.error("OpenClaw workspace folder is unavailable.");
      return;
    }

    try {
      await openLocalFolderUrl(pathToFileUrl(desktopReadyData.workspacePath));
    } catch {
      toast.error("Failed to open OpenClaw workspace folder.");
    }
  }, [desktopReadyData?.workspacePath]);

  return (
    <div className="h-full overflow-y-auto">
      <div
        className="max-w-4xl mx-auto px-4 sm:px-6 pb-6 sm:pb-8"
        style={{ paddingTop: isDesktopClient ? "2rem" : "0.5rem" }}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="heading-page">{t("models.pageTitle")}</h2>
            <p className="heading-page-desc">{t("models.pageSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <GitHubStarCta
              label={t("home.starGithub")}
              stars={starNexu}
              variant="button"
              onClick={() =>
                track("workspace_github_click", { source: "settings" })
              }
            />
            <button
              type="button"
              onClick={() => {
                void handleOpenWorkspace();
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium text-text-primary hover:border-border-hover hover:bg-surface-1 transition-colors"
            >
              <FolderOpen size={13} />
              Workspace
            </button>
          </div>
        </div>

        <div>
          {/* Provider sidebar + detail */}
          <div
            className="flex gap-0 rounded-xl border border-border bg-surface-1 overflow-hidden"
            style={{ minHeight: 520 }}
          >
            {/* Left: Provider list with Enabled / Providers grouping */}
            {/* Left: Provider list — flat, no enabled/disabled split */}
            <div className="w-56 shrink-0 bg-surface-0 overflow-y-auto">
              <div className="p-2 space-y-0.5">
                {sidebarItems.map((item) => {
                  const isActive = activeProvider?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setSelectedProviderId(item.id);
                        clearSetupParam();
                      }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-colors",
                        isActive ? "bg-surface-3" : "hover:bg-surface-2",
                      )}
                    >
                      <span className="w-6 h-6 shrink-0 flex items-center justify-center rounded-md bg-white border border-border-subtle">
                        <ProviderLogo provider={item.id} size={14} />
                      </span>
                      <span
                        className={cn(
                          "flex-1 text-[12px] truncate",
                          isActive
                            ? "font-semibold text-text-primary"
                            : "font-medium text-text-primary",
                        )}
                      >
                        {item.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {activeProvider ? (
                activeProvider.managed ? (
                  modelsLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-[13px] text-text-muted">
                        {t("models.loading")}
                      </div>
                    </div>
                  ) : modelsError ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <div className="text-[13px] text-red-500 mb-2">
                          {t("models.loadFailed")}
                        </div>
                        <p className="text-[12px] text-text-muted mb-3">
                          {t("models.loadFailedHint")}
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            queryClient.invalidateQueries({
                              queryKey: ["models"],
                            })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium bg-surface-2 hover:bg-surface-3 text-text-primary transition-colors"
                        >
                          <RefreshCw size={12} />
                          {t("models.retry")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <ManagedProviderDetail
                      provider={
                        providers.find((p) => p.id === activeProvider.id) ?? {
                          id: activeProvider.id,
                          name: activeProvider.name,
                          description:
                            PROVIDER_META[activeProvider.id]?.descriptionKey ??
                            "",
                          managed: true,
                          models: [],
                        }
                      }
                      currentModelId={currentModelId}
                      onSelectModel={(modelId) => updateModel.mutate(modelId)}
                    />
                  )
                ) : (
                  <ByokProviderDetail
                    providerId={activeProvider.id as ByokProviderId}
                    dbProvider={dbProviders.find(
                      (p) => p.providerId === activeProvider.id,
                    )}
                    queryClient={queryClient}
                    currentModelId={currentModelId}
                    onAutoSelectModel={handleAutoSelectModel}
                    onSelectModel={(modelId) => updateModel.mutate(modelId)}
                  />
                )
              ) : (
                <div className="flex items-center justify-center h-full text-[13px] text-text-muted">
                  {t("models.selectProvider")}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Managed provider detail (Nexu Official) ───────────────────

function ManagedProviderDetail({
  provider,
  currentModelId,
  onSelectModel,
}: {
  provider: ProviderConfig;
  currentModelId: string;
  onSelectModel: (modelId: string) => void;
}) {
  const { t } = useTranslation();

  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [cloudConnected, setCloudConnected] = useState(false);
  const [cloudDisconnecting, setCloudDisconnecting] = useState(false);
  const queryClient = useQueryClient();
  const refreshCloudModels = useMutation({
    mutationFn: async () => {
      await postApiInternalDesktopCloudRefresh();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["models"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-default-model"] });
      toast.success(t("models.managed.refreshSucceeded"));
    },
    onError: () => {
      toast.error(t("models.managed.refreshFailed"));
    },
  });

  // Check if already connected on mount
  useEffect(() => {
    getApiInternalDesktopCloudStatus()
      .then(({ data }) => {
        if (data?.connected) setCloudConnected(true);
      })
      .catch(() => {});
  }, []);

  // Poll cloud-status while waiting for browser login
  useEffect(() => {
    if (!loginBusy) return;
    const interval = setInterval(async () => {
      try {
        const { data } = await getApiInternalDesktopCloudStatus();
        if (data?.connected) {
          setLoginBusy(false);
          setCloudConnected(true);
          queryClient.invalidateQueries({ queryKey: ["models"] });
          queryClient.invalidateQueries({
            queryKey: ["desktop-default-model"],
          });
        }
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [loginBusy, queryClient]);

  const handleLogin = async () => {
    setLoginBusy(true);
    setLoginError(null);
    try {
      let { data } = await postApiInternalDesktopCloudConnect();
      // If a stale polling session exists (error field set), disconnect and retry once
      if (data?.error) {
        await postApiInternalDesktopCloudDisconnect().catch(() => {});
        ({ data } = await postApiInternalDesktopCloudConnect());
      }
      if (data?.error) {
        setLoginError(data.error ?? t("welcome.connectFailed"));
        setLoginBusy(false);
        return;
      }
      if (data?.browserUrl) {
        window.open(data.browserUrl, "_blank", "noopener,noreferrer");
      }
      // Keep loginBusy=true — polling effect will detect completion.
    } catch {
      setLoginError(t("welcome.cloudConnectError"));
      setLoginBusy(false);
    }
  };

  const handleCancelLogin = async () => {
    try {
      await postApiInternalDesktopCloudDisconnect();
    } catch {
      // ignore
    }
    setLoginBusy(false);
    setLoginError(null);
  };

  const cloudToggleBusy = loginBusy || cloudDisconnecting;

  return (
    <div>
      {/* Header + cloud connection text action */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-2 shrink-0">
            <ProviderLogo provider={provider.id} size={20} />
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-text-primary">
              {provider.name}
            </div>
            <div className="text-[11px] text-text-tertiary">
              {t(provider.description)}
            </div>
          </div>
        </div>
        {(cloudConnected || loginBusy) && (
          <button
            type="button"
            disabled={cloudToggleBusy}
            aria-busy={cloudToggleBusy}
            aria-label={
              cloudConnected
                ? t("models.managed.cloudDisconnectAria")
                : t("models.managed.cloudConnectAria")
            }
            onClick={async () => {
              if (cloudConnected) {
                if (cloudDisconnecting) return;
                setCloudDisconnecting(true);
                try {
                  await postApiInternalDesktopCloudDisconnect().catch(() => {});
                  setCloudConnected(false);
                  queryClient.invalidateQueries({ queryKey: ["models"] });
                  queryClient.invalidateQueries({
                    queryKey: ["desktop-default-model"],
                  });
                } finally {
                  setCloudDisconnecting(false);
                }
              }
            }}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium shrink-0 rounded-lg border border-border px-2.5 py-1 transition-colors cursor-pointer text-text-secondary hover:text-text-primary hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {(cloudDisconnecting || loginBusy) && (
              <Loader2 size={12} className="animate-spin shrink-0" />
            )}
            <span className="truncate">
              {loginBusy
                ? t("models.managed.waitingLogin")
                : t("models.managed.connected")}
            </span>
          </button>
        )}
      </div>

      {/* Login prompt */}
      {!cloudConnected && (
        <div className="rounded-xl border border-[var(--color-brand-primary)]/25 bg-[var(--color-brand-subtle)] px-4 py-4 mb-6">
          <div className="text-[13px] font-semibold text-[var(--color-brand-primary)]">
            {t("models.managed.loginPrompt")}
          </div>
          <div className="text-[12px] leading-[1.7] text-text-secondary mt-1.5">
            {t("models.managed.loginDescription")}
          </div>
          {loginBusy ? (
            <div className="mt-4 flex items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-lg bg-accent/80 px-3.5 py-2 text-[12px] font-medium text-white">
                <Loader2 size={13} className="animate-spin" />
                {t("models.managed.waitingLogin")}
              </div>
              <button
                type="button"
                onClick={() => void handleCancelLogin()}
                className="text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              >
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleLogin()}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[12px] font-medium text-accent-fg transition-colors hover:bg-accent/90 cursor-pointer"
            >
              {t("models.managed.loginButton")}
              <ArrowUpRight size={13} />
            </button>
          )}
          {loginError && (
            <p className="mt-2 text-[11px] text-red-500">{loginError}</p>
          )}
        </div>
      )}

      {/* Cloud models — clickable to switch active model */}
      {provider.models.length > 0 && (
        <div className="mb-6 pt-5 border-t border-border-subtle">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
              {t("models.managed.availableModels")}
              <span className="ml-1.5 normal-case tracking-normal">
                ({provider.models.length})
              </span>
            </div>
            {cloudConnected && (
              <button
                type="button"
                onClick={() => {
                  refreshCloudModels.mutate();
                }}
                disabled={refreshCloudModels.isPending}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
              >
                <RefreshCw
                  size={10}
                  className={cn(refreshCloudModels.isPending && "animate-spin")}
                />
                {t("models.managed.refreshModelList")}
              </button>
            )}
          </div>
          <div className="space-y-0.5">
            {provider.models.map((model) => {
              const isSelected = isModelSelected(model.id, currentModelId);
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    if (!isSelected) onSelectModel(model.id);
                  }}
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                    isSelected ? "bg-surface-2" : "hover:bg-surface-2",
                  )}
                >
                  <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-white border border-border-subtle">
                    <ModelLogo
                      model={model.name}
                      provider={provider.id}
                      size={14}
                    />
                  </span>
                  <span
                    className={cn(
                      "flex-1 text-[12px] truncate",
                      isSelected
                        ? "font-semibold text-text-primary"
                        : "font-medium text-text-primary",
                    )}
                  >
                    {model.name}
                  </span>
                  {isSelected && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-text-secondary shrink-0">
                      <Check size={12} />
                      Active
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── BYOK provider detail panel ────────────────────────────────

function ByokProviderDetail({
  providerId,
  dbProvider,
  queryClient,
  currentModelId,
  onAutoSelectModel,
  onSelectModel,
}: {
  providerId: ByokProviderId;
  dbProvider?: DbProvider;
  queryClient: ReturnType<typeof useQueryClient>;
  currentModelId: string;
  onAutoSelectModel: (modelId: string) => void;
  onSelectModel: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const meta = PROVIDER_META[providerId] ?? {
    name: providerId,
    descriptionKey: "",
    apiDocsUrl: undefined,
    apiKeyPlaceholder: "your-api-key",
    defaultProxyUrl: "",
  };

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    dbProvider?.baseUrl ?? meta.defaultProxyUrl ?? "",
  );
  const [authMode, setAuthMode] = useState<"apiKey" | "oauth">(
    getDefaultMiniMaxAuthMode(providerId, dbProvider),
  );
  const [oauthRegion, setOauthRegion] = useState<"global" | "cn">(
    dbProvider?.oauthRegion ?? "global",
  );
  const [dismissedMiniMaxOauthError, setDismissedMiniMaxOauthError] = useState<
    string | null
  >(null);
  const [isEditingApiKey, setIsEditingApiKey] = useState(
    !dbProvider?.hasApiKey,
  );
  const isMiniMax = providerId === "minimax";
  const hostBridge = getModelsHostInvokeBridge();

  const { data: minimaxOauthStatus } = useQuery({
    queryKey: ["minimax-oauth-status"],
    enabled: isMiniMax,
    queryFn: async () => {
      if (hostBridge) {
        return hostBridge.invoke("desktop:get-minimax-oauth-status", undefined);
      }
      const { data } = await getApiV1ProvidersMinimaxOauthStatus();
      return data;
    },
    refetchInterval: (query) => (query.state.data?.inProgress ? 2000 : false),
  });

  const hasMiniMaxOauthAccess =
    isMiniMax &&
    (minimaxOauthStatus?.connected === true || dbProvider?.hasOauthCredential);
  const hasSavedAccess = Boolean(
    dbProvider?.hasApiKey || hasMiniMaxOauthAccess,
  );

  const visibleMiniMaxOauthError =
    minimaxOauthStatus?.error &&
    minimaxOauthStatus.error !== dismissedMiniMaxOauthError
      ? minimaxOauthStatus.error
      : null;

  // Available models from verification
  const [verifiedModels, setVerifiedModels] = useState<string[] | null>(null);

  // ── OAuth state (OpenAI only) ──────────────────────────
  const isOAuthProvider = providerId === "openai";
  const [oauthPending, setOauthPending] = useState(false);

  const oauthProviderStatus = useQuery({
    queryKey: ["oauth-provider-status", providerId],
    queryFn: async () => {
      const res = await getApiV1ProvidersByProviderIdOauthProviderStatus({
        path: { providerId },
      });
      return res.data ?? { connected: false };
    },
    enabled: isOAuthProvider,
    refetchInterval: false,
  });

  const oauthFlowStatus = useQuery({
    queryKey: ["oauth-flow-status", providerId],
    queryFn: async () => {
      const res = await getApiV1ProvidersByProviderIdOauthStatus({
        path: { providerId },
      });
      return res.data ?? { status: "idle" as const };
    },
    enabled: isOAuthProvider && oauthPending,
    refetchInterval: oauthPending ? 2000 : false,
  });

  // React to flow status changes
  const flowDataStatus = oauthFlowStatus.data?.status;
  const flowDataError = oauthFlowStatus.data?.error;
  useEffect(() => {
    if (!oauthPending) return;
    if (flowDataStatus === "completed") {
      setOauthPending(false);
      queryClient.invalidateQueries({ queryKey: ["oauth-provider-status"] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      toast.success(t("models.byok.oauthSuccess"));
      markSetupComplete();
    } else if (flowDataStatus === "failed") {
      setOauthPending(false);
      toast.error(flowDataError ?? t("models.byok.oauthFailed"));
    }
  }, [flowDataStatus, flowDataError, oauthPending, queryClient, t]);

  const startOAuthMutation = useMutation({
    mutationFn: async () => {
      const res = await postApiV1ProvidersByProviderIdOauthStart({
        path: { providerId },
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data?.browserUrl) {
        window.open(data.browserUrl, "_blank");
        setOauthPending(true);
      } else if (data?.error) {
        toast.error(data.error);
      }
    },
  });

  const disconnectOAuthMutation = useMutation({
    mutationFn: async () => {
      const res = await postApiV1ProvidersByProviderIdOauthDisconnect({
        path: { providerId },
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["oauth-provider-status"] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const isOAuthConnected =
    isOAuthProvider && oauthProviderStatus.data?.connected === true;

  // ── Z.AI Coding Plan state ───────────────────────────
  const isZaiProvider = providerId === "glm";
  const [codingPlanKey, setCodingPlanKey] = useState("");
  const [codingPlanRegion, setCodingPlanRegion] = useState<"global" | "cn">(
    "global",
  );

  const saveCodingPlanMutation = useMutation({
    mutationFn: () =>
      saveProvider(providerId, {
        apiKey: codingPlanKey,
        baseUrl: ZAI_CODING_PLAN_URLS[codingPlanRegion],
        displayName: "GLM",
        enabled: true,
        modelsJson: JSON.stringify(ZAI_CODING_PLAN_MODELS),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      setCodingPlanKey("");
      markSetupComplete();
      const preferred = selectPreferredModel(ZAI_CODING_PLAN_MODELS);
      if (preferred) {
        onAutoSelectModel(preferred);
      }
    },
  });

  // Reset form when provider changes
  useEffect(() => {
    setApiKey("");
    setBaseUrl(dbProvider?.baseUrl ?? meta.defaultProxyUrl ?? "");
    setAuthMode(getDefaultMiniMaxAuthMode(providerId, dbProvider));
    setOauthRegion(dbProvider?.oauthRegion ?? "global");
    setIsEditingApiKey(!dbProvider?.hasApiKey);
    setVerifiedModels(null);
    setOauthPending(false);
    setCodingPlanKey("");
    setCodingPlanRegion("global");
  }, [dbProvider, meta.defaultProxyUrl, providerId]);

  useEffect(() => {
    if (!isMiniMax) {
      return;
    }

    if (authMode !== "oauth") {
      setVerifiedModels(null);
      return;
    }

    const stored: string[] = JSON.parse(dbProvider?.modelsJson ?? "[]");
    setVerifiedModels(stored.length > 0 ? stored : null);
  }, [authMode, dbProvider?.modelsJson, isMiniMax]);

  // ── Verify mutation ──────────────────────────────────
  const verifyMutation = useMutation({
    mutationFn: () => verifyApiKey(providerId, apiKey, baseUrl || undefined),
    onSuccess: (result) => {
      track("workspace_provider_check", {
        provider_name: providerId,
        success: result.valid,
      });
      if (result.valid && result.models) {
        setVerifiedModels(result.models);
      }
    },
    onError: () => {
      track("workspace_provider_check", {
        provider_name: providerId,
        success: false,
      });
    },
  });

  // ── Save mutation ────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Auto-fetch models if none available yet
      let models = displayModels;
      if (models.length === 0 && apiKey) {
        const result = await verifyApiKey(
          providerId,
          apiKey,
          baseUrl || undefined,
        );
        if (result.valid && result.models && result.models.length > 0) {
          models = result.models;
          setVerifiedModels(result.models);
        }
      }
      return saveProvider(providerId, {
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || null,
        displayName: meta.name,
        enabled: true,
        authMode: "apiKey",
        modelsJson: JSON.stringify(models),
      });
    },
    onSuccess: () => {
      track("workspace_provider_save", {
        provider_name: providerId,
      });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      setApiKey("");
      setIsEditingApiKey(false);
      markSetupComplete();
      // Auto-select preferred model if no model is currently selected
      const preferred = selectPreferredModel(displayModels);
      if (preferred) {
        onAutoSelectModel(preferred);
      }
    },
  });

  // ── Delete mutation ──────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => deleteProvider(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      if (isMiniMax) {
        queryClient.setQueryData(["minimax-oauth-status"], {
          connected: false,
          inProgress: false,
          region: oauthRegion,
          error: null,
        });
        queryClient.invalidateQueries({ queryKey: ["minimax-oauth-status"] });
      }
      setApiKey("");
      setBaseUrl(meta.defaultProxyUrl ?? "");
      setIsEditingApiKey(true);
      setVerifiedModels(null);
    },
  });

  const minimaxOauthMutation = useMutation({
    mutationFn: async () => {
      if (hostBridge) {
        return hostBridge.invoke("desktop:start-minimax-oauth", {
          region: oauthRegion,
        });
      }
      const { data, error } = await postApiV1ProvidersMinimaxOauthLogin({
        body: { region: oauthRegion },
      });
      if (error || !data) {
        throw new Error("Failed to start MiniMax OAuth login");
      }
      return data;
    },
    onSuccess: (result) => {
      const browserUrl =
        "browserUrl" in result && typeof result.browserUrl === "string"
          ? result.browserUrl
          : null;
      if (browserUrl) {
        window.open(browserUrl, "_blank", "noopener,noreferrer");
      }
      queryClient.invalidateQueries({ queryKey: ["minimax-oauth-status"] });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["minimax-oauth-status"] });
      setMiniMaxOauthErrorInCache(
        queryClient,
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  });

  const cancelMiniMaxOauthMutation = useMutation({
    mutationFn: async () => {
      if (hostBridge) {
        return hostBridge.invoke("desktop:cancel-minimax-oauth", undefined);
      }
      const { data, error } = await deleteApiV1ProvidersMinimaxOauthLogin();
      if (error || !data) {
        throw new Error("Failed to cancel MiniMax OAuth login");
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["minimax-oauth-status"] });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["minimax-oauth-status"] });
      setMiniMaxOauthErrorInCache(
        queryClient,
        error instanceof Error ? error : new Error(String(error)),
      );
    },
  });

  useEffect(() => {
    if (!isMiniMax || !minimaxOauthStatus?.connected) {
      return;
    }

    const syncOauthModels = async () => {
      const providers = await queryClient.fetchQuery({
        queryKey: ["providers"],
        queryFn: fetchProviders,
      });
      const minimaxProvider = providers.find(
        (provider) => provider.providerId === "minimax",
      );

      const providerModels: string[] = JSON.parse(
        minimaxProvider?.modelsJson ?? "[]",
      );
      if (providerModels.length > 0) {
        setVerifiedModels(providerModels);
      }

      await queryClient.refetchQueries({ queryKey: ["models"] });
      await queryClient.refetchQueries({ queryKey: ["desktop-default-model"] });
    };

    void syncOauthModels();
  }, [isMiniMax, minimaxOauthStatus?.connected, queryClient]);

  // Model list to show: verified > DB stored > defaults
  const displayModels = useMemo(() => {
    if (verifiedModels && verifiedModels.length > 0) return verifiedModels;
    const stored: string[] = JSON.parse(dbProvider?.modelsJson ?? "[]");
    if (stored.length > 0) return stored;
    return DEFAULT_MODELS[providerId] ?? [];
  }, [verifiedModels, dbProvider, providerId]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-2 shrink-0">
            <ProviderLogo provider={providerId} size={20} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-[14px] font-semibold text-text-primary">
                {meta.name}
              </div>
              {meta.apiDocsUrl && (
                <a
                  href={meta.apiDocsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-link text-[11px]"
                >
                  {t("models.byok.getApiKey")}
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
            <div className="text-[11px] text-text-tertiary">
              {t(meta.descriptionKey)}
            </div>
          </div>
        </div>
      </div>

      {/* OAuth section (OpenAI only) */}
      {isOAuthProvider && (
        <div className="mb-6">
          {isOAuthConnected ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-emerald-700 dark:text-emerald-400">
                  {t("models.byok.oauthConnected")}
                </div>
                <div className="text-[10px] text-emerald-600/70 dark:text-emerald-500/70">
                  {t("models.byok.oauthDescription")}
                </div>
              </div>
              <button
                type="button"
                disabled={disconnectOAuthMutation.isPending}
                onClick={() => {
                  if (confirm(t("models.byok.confirmRemove"))) {
                    disconnectOAuthMutation.mutate();
                  }
                }}
                className="shrink-0 rounded-lg border border-border px-3 py-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-2"
              >
                {disconnectOAuthMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  t("models.byok.oauthDisconnect")
                )}
              </button>
            </div>
          ) : oauthPending ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-1 px-3 py-3">
              <Loader2 size={14} className="animate-spin text-text-muted" />
              <span className="text-[12px] text-text-secondary">
                {t("models.byok.oauthPending")}
              </span>
            </div>
          ) : (
            <button
              type="button"
              disabled={startOAuthMutation.isPending}
              onClick={() => startOAuthMutation.mutate()}
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-0 px-4 py-2.5 text-[12px] font-medium text-text-primary transition-colors hover:bg-surface-2"
            >
              {startOAuthMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <LogIn size={14} />
              )}
              {t("models.byok.oauthLoginChatGPT")}
            </button>
          )}

          {!isOAuthConnected && (
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 border-t border-border" />
              <span className="text-[10px] text-text-muted">
                {t("models.byok.oauthOrApiKey")}
              </span>
              <div className="flex-1 border-t border-border" />
            </div>
          )}
        </div>
      )}

      {isMiniMax && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-border bg-surface-0 p-1">
          <button
            type="button"
            onClick={() => setAuthMode("oauth")}
            className={cn(
              "rounded-md px-3 py-2 text-[12px] font-medium transition-colors",
              authMode === "oauth"
                ? "bg-accent text-accent-fg"
                : "text-text-secondary hover:bg-surface-2",
            )}
          >
            {t("models.byok.minimax.authModeOauth")}
          </button>
          <button
            type="button"
            onClick={() => setAuthMode("apiKey")}
            className={cn(
              "rounded-md px-3 py-2 text-[12px] font-medium transition-colors",
              authMode === "apiKey"
                ? "bg-accent text-accent-fg"
                : "text-text-secondary hover:bg-surface-2",
            )}
          >
            {t("models.byok.minimax.authModeApiKey")}
          </button>
        </div>
      )}

      {isMiniMax && authMode === "oauth" ? (
        <div className="space-y-4 mb-6">
          <div className="rounded-xl border border-border bg-surface-0 p-4">
            <div className="mb-3 text-[12px] font-medium text-text-primary">
              {t("models.byok.minimax.oauthTitle")}
            </div>
            <div className="mb-4 text-[11px] leading-6 text-text-secondary">
              {t("models.byok.minimax.oauthDescription")}
            </div>
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOauthRegion("global")}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors",
                  oauthRegion === "global"
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-text-secondary hover:bg-surface-2",
                )}
              >
                {t("models.byok.minimax.regionGlobal")}
              </button>
              <button
                type="button"
                onClick={() => setOauthRegion("cn")}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-[11px] font-medium transition-colors",
                  oauthRegion === "cn"
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-text-secondary hover:bg-surface-2",
                )}
              >
                {t("models.byok.minimax.regionCn")}
              </button>
            </div>
            <div className="mb-4 text-[10px] text-text-muted">
              {t("models.byok.minimax.endpoint", {
                endpoint:
                  oauthRegion === "cn" ? "api.minimaxi.com" : "api.minimax.io",
              })}
            </div>
            {minimaxOauthStatus?.connected || dbProvider?.hasOauthCredential ? (
              <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11px] text-emerald-700">
                {t("models.byok.minimax.connected")}
                {dbProvider?.oauthEmail ? ` · ${dbProvider.oauthEmail}` : ""}
              </div>
            ) : null}
            {visibleMiniMaxOauthError ? (
              <div className="mb-4 flex items-start justify-between gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-600">
                <div className="min-w-0 flex-1">{visibleMiniMaxOauthError}</div>
                <button
                  type="button"
                  onClick={() =>
                    setDismissedMiniMaxOauthError(visibleMiniMaxOauthError)
                  }
                  className="rounded p-0.5 text-red-500/80 transition-colors hover:bg-red-500/10 hover:text-red-600"
                  aria-label={t("models.byok.minimax.dismissError")}
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}
            <div className="flex items-center gap-3">
              {minimaxOauthStatus?.inProgress ? (
                <>
                  <button
                    type="button"
                    disabled
                    className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[12px] font-medium text-accent-fg opacity-80"
                  >
                    <Loader2 size={13} className="animate-spin" />
                    {t("models.byok.minimax.waitingLogin")}
                  </button>
                  <button
                    type="button"
                    onClick={() => cancelMiniMaxOauthMutation.mutate()}
                    className="rounded-lg px-3 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-2"
                  >
                    {t("models.byok.minimax.cancel")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => minimaxOauthMutation.mutate()}
                    disabled={minimaxOauthMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-2 disabled:opacity-60"
                  >
                    {minimaxOauthMutation.isPending && (
                      <Loader2 size={13} className="animate-spin" />
                    )}
                    {!minimaxOauthMutation.isPending &&
                      (hasMiniMaxOauthAccess ? (
                        <RefreshCw size={13} />
                      ) : (
                        <LogIn size={13} />
                      ))}
                    {hasMiniMaxOauthAccess
                      ? t("models.byok.minimax.reconnect")
                      : t("models.byok.minimax.login")}
                  </button>
                  {hasSavedAccess && (
                    <button
                      type="button"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (confirm(t("models.byok.confirmRemove"))) {
                          deleteMutation.mutate();
                        }
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/5"
                    >
                      {deleteMutation.isPending ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                      {t("models.byok.remove")}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Z.AI Coding Plan section (GLM only) */}
      {isZaiProvider && (
        <div className="mb-6">
          <div className="rounded-lg border border-border bg-surface-0 p-4">
            <div className="text-[12px] font-medium text-text-primary mb-1">
              {t("models.byok.zaiCodingPlan")}
            </div>
            <div className="text-[10px] text-text-muted mb-3">
              {t("models.byok.zaiCodingPlanDesc")}
            </div>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => setCodingPlanRegion("global")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors",
                  codingPlanRegion === "global"
                    ? "bg-accent text-accent-fg"
                    : "bg-surface-2 text-text-secondary hover:bg-surface-3",
                )}
              >
                Global
              </button>
              <button
                type="button"
                onClick={() => setCodingPlanRegion("cn")}
                className={cn(
                  "px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors",
                  codingPlanRegion === "cn"
                    ? "bg-accent text-accent-fg"
                    : "bg-surface-2 text-text-secondary hover:bg-surface-3",
                )}
              >
                CN
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                value={codingPlanKey}
                onChange={(e) => setCodingPlanKey(e.target.value)}
                placeholder="sk-..."
                className="flex-1 rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20 focus:border-[var(--color-brand-primary)]/30"
              />
              <button
                type="button"
                disabled={!codingPlanKey || saveCodingPlanMutation.isPending}
                onClick={() => saveCodingPlanMutation.mutate()}
                className={cn(
                  "px-4 py-2 rounded-lg text-[12px] font-medium transition-colors",
                  codingPlanKey
                    ? "bg-accent text-accent-fg hover:bg-accent/90"
                    : "bg-surface-2 text-text-muted cursor-not-allowed",
                )}
              >
                {saveCodingPlanMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  t("models.byok.saveAndEnable")
                )}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 border-t border-border" />
            <span className="text-[10px] text-text-muted">
              {t("models.byok.zaiOrGeneralApi")}
            </span>
            <div className="flex-1 border-t border-border" />
          </div>
        </div>
      )}

      {!isOAuthConnected && (!isMiniMax || authMode === "apiKey") && (
        <div className="space-y-4 mb-6">
          <div>
            <label
              htmlFor={`apikey-${providerId}`}
              className="block text-[12px] font-medium text-text-secondary mb-1.5"
            >
              {t("models.byok.apiKey")}
            </label>
            {dbProvider?.hasApiKey && !isEditingApiKey ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-brand-primary)]/25 bg-[var(--color-brand-subtle)] px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-text-primary">
                    {t("models.byok.apiKeySaved")}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {t("models.byok.apiKeySavedHint")}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditingApiKey(true)}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-2"
                >
                  {t("models.byok.changeApiKey")}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  id={`apikey-${providerId}`}
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={meta.apiKeyPlaceholder}
                  className="flex-1 rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20 focus:border-[var(--color-brand-primary)]/30"
                />
                <button
                  type="button"
                  disabled={!apiKey || verifyMutation.isPending}
                  onClick={() => verifyMutation.mutate()}
                  className={cn(
                    "px-3 py-2 rounded-lg border border-border text-[11px] font-medium transition-colors",
                    apiKey
                      ? "text-text-secondary hover:bg-surface-2"
                      : "text-text-muted cursor-not-allowed",
                  )}
                >
                  {verifyMutation.isPending ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : verifyMutation.isSuccess && verifyMutation.data?.valid ? (
                    <Check size={12} className="text-emerald-600" />
                  ) : (
                    t("models.byok.verify")
                  )}
                </button>
              </div>
            )}
            {verifyMutation.isSuccess && (
              <div
                className={cn(
                  "mt-1.5 text-[10px]",
                  verifyMutation.data?.valid
                    ? "text-emerald-600"
                    : "text-red-500",
                )}
              >
                {verifyMutation.data?.valid
                  ? t("models.byok.keyValid", {
                      count: verifyMutation.data.models?.length ?? 0,
                    })
                  : t("models.byok.keyInvalid", {
                      error:
                        verifyMutation.data?.error ??
                        t("models.byok.keyInvalidUnknown"),
                    })}
              </div>
            )}
          </div>
          <div>
            <label
              htmlFor={`baseurl-${providerId}`}
              className="block text-[12px] font-medium text-text-secondary mb-1.5"
            >
              {t("models.byok.proxyUrl")}
            </label>
            {isMiniMax && (
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBaseUrl("https://api.minimax.io/anthropic")}
                  className="rounded-md border border-border px-2.5 py-1 text-[10px] text-text-secondary transition-colors hover:bg-surface-2"
                >
                  {t("models.byok.minimax.regionGlobal")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setBaseUrl("https://api.minimaxi.com/anthropic")
                  }
                  className="rounded-md border border-border px-2.5 py-1 text-[10px] text-text-secondary transition-colors hover:bg-surface-2"
                >
                  {t("models.byok.minimax.regionCn")}
                </button>
              </div>
            )}
            <input
              id={`baseurl-${providerId}`}
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={meta.defaultProxyUrl || "https://api.example.com/v1"}
              className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-primary)]/20 focus:border-[var(--color-brand-primary)]/30"
            />
          </div>
        </div>
      )}

      {!isOAuthConnected && (
        <div className="flex items-center gap-3 mb-6">
          {(!isMiniMax || authMode === "apiKey") && (
            <button
              type="button"
              disabled={
                saveMutation.isPending || (!apiKey && !dbProvider?.hasApiKey)
              }
              onClick={() => saveMutation.mutate()}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-medium transition-colors",
                !saveMutation.isPending && (apiKey || dbProvider?.hasApiKey)
                  ? "bg-accent text-accent-fg hover:bg-accent/90"
                  : "bg-surface-2 text-text-muted cursor-not-allowed",
              )}
            >
              {saveMutation.isPending && (
                <Loader2 size={13} className="animate-spin" />
              )}
              {dbProvider?.hasApiKey
                ? t("models.byok.updateConfig")
                : t("models.byok.saveAndEnable")}
            </button>
          )}

          {hasSavedAccess && (!isMiniMax || authMode !== "oauth") && (
            <button
              type="button"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (confirm(t("models.byok.confirmRemove"))) {
                  deleteMutation.mutate();
                }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-[12px] font-medium text-red-500 transition-colors hover:bg-red-500/5"
            >
              {deleteMutation.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Trash2 size={13} />
              )}
              {t("models.byok.remove")}
            </button>
          )}
        </div>
      )}

      {!isOAuthConnected &&
        (!isMiniMax || authMode === "apiKey") &&
        saveMutation.isSuccess && (
          <div className="mb-4 text-[11px] text-[var(--color-success)]">
            {t("models.byok.saveSuccess")}
          </div>
        )}
      {!isOAuthConnected &&
        (!isMiniMax || authMode === "apiKey") &&
        saveMutation.isError && (
          <div className="mb-4 text-[11px] text-red-500">
            {t("models.byok.saveFailed")}
          </div>
        )}

      {/* Model list — clickable to switch active model */}
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary mb-2">
          {t("models.byok.modelList")}
          <span className="ml-1.5 normal-case tracking-normal">
            ({displayModels.length})
          </span>
        </div>
        <div className="space-y-0.5">
          {displayModels.length === 0 && (
            <div className="text-[11px] text-text-muted/60 py-3 text-center">
              {t("models.byok.none")}
            </div>
          )}
          {displayModels.map((modelId) => {
            const isSelected = isModelSelected(modelId, currentModelId);
            return (
              <button
                key={modelId}
                type="button"
                onClick={() => {
                  if (!isSelected) onSelectModel(modelId);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                  isSelected ? "bg-surface-2" : "hover:bg-surface-2",
                )}
              >
                <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-white border border-border-subtle">
                  <ModelLogo model={modelId} provider={providerId} size={14} />
                </span>
                <span
                  className={cn(
                    "flex-1 text-[12px] truncate",
                    isSelected
                      ? "font-semibold text-text-primary"
                      : "font-medium text-text-primary",
                  )}
                >
                  {modelId}
                </span>
                {isSelected && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-text-secondary shrink-0">
                    <Check size={12} />
                    Active
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
