import { LanguageSwitcher } from "@/components/language-switcher";
import { ProviderLogo } from "@/components/provider-logo";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Camera,
  Check,
  ChevronDown,
  Cpu,
  ExternalLink,
  FolderOpen,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  deleteApiV1ProvidersByProviderId,
  getApiInternalDesktopCloudStatus,
  getApiInternalDesktopDefaultModel,
  getApiV1LinkCatalog,
  getApiV1Me,
  getApiV1Models,
  getApiV1Providers,
  patchApiV1Me,
  postApiInternalDesktopCloudConnect,
  postApiInternalDesktopCloudDisconnect,
  postApiV1ProvidersByProviderIdVerify,
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
  hasApiKey: boolean;
  modelsJson: string;
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
    name: "Nexu Official",
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
    defaultProxyUrl: "https://api.minimaxi.com/anthropic",
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
  custom: {
    name: "Custom",
    descriptionKey: "models.provider.custom.description",
    apiKeyPlaceholder: "your-api-key",
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
  openai: ["gpt-5.1", "gpt-5-mini", "gpt-5-nano", "o4-mini"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
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
    "MiniMax-VL-01",
  ],
  kimi: ["kimi-k2.5"],
  glm: ["glm-5", "glm-5-turbo", "glm-4.7", "glm-4.7-flash"],
  moonshot: ["kimi-k2.5"],
  zai: ["glm-5", "glm-5-turbo", "glm-4.7", "glm-4.7-flashx"],
};

const GITHUB_URL = "https://github.com/nexu-io/nexu";

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
  providerId: string,
  body: {
    apiKey?: string;
    baseUrl?: string | null;
    enabled?: boolean;
    displayName?: string;
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

async function deleteProvider(providerId: string): Promise<void> {
  const { error } = await deleteApiV1ProvidersByProviderId({
    path: { providerId },
  });
  if (error) throw new Error("Failed to delete provider");
}

async function verifyApiKey(
  providerId: string,
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
  "custom",
] as const;

// ── Model grouping helpers (same as home.tsx) ─────────────────

function getGroupKey(m: { id: string; provider: string }): string {
  return m.id.startsWith("link/") ? "nexu" : m.provider;
}

const PROVIDER_LABELS: Record<string, string> = {
  nexu: "Nexu Official",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI",
  siliconflow: "SiliconFlow",
  ppio: "PPIO",
  openrouter: "OpenRouter",
  minimax: "MiniMax",
  kimi: "Kimi",
  glm: "GLM",
  moonshot: "Kimi",
  zai: "GLM",
};

// ── Component ──────────────────────────────────────────────────

function _GeneralSettings() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const queryClient = useQueryClient();
  const [draftName, setDraftName] = useState("");
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [hasStarred, setHasStarred] = useState(
    () => localStorage.getItem("nexu_starred") === "1",
  );

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
      <button
        type="button"
        onClick={() => {
          localStorage.setItem("nexu_starred", "1");
          setHasStarred(true);
          window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
        }}
        className="group relative w-full overflow-hidden rounded-2xl text-left transition-transform hover:scale-[1.005]"
        style={{
          background:
            "linear-gradient(135deg, #0d0d10 0%, #1a1a2e 40%, #16213e 70%, #0d0d10 100%)",
          minHeight: 120,
        }}
      >
        <div className="absolute inset-0 opacity-40 [background:radial-gradient(ellipse_at_30%_50%,rgba(61,185,206,0.15)_0%,transparent_60%)]" />
        <div className="absolute inset-0 opacity-30 [background:radial-gradient(ellipse_at_70%_30%,rgba(61,185,206,0.1)_0%,transparent_50%)]" />
        <div className="absolute right-6 top-1/2 -translate-y-1/2 select-none text-[48px] font-bold tracking-[0.2em] text-white/[0.03]">
          {"> <"}
        </div>
        <div className="absolute right-3 top-3 flex gap-1 opacity-20">
          {[0, 1, 2, 3, 4, 5].map((dot) => (
            <div key={dot} className="h-1 w-1 rounded-full bg-white" />
          ))}
        </div>
        <div className="absolute bottom-3 left-3 flex gap-1 opacity-10">
          {[0, 1, 2, 3].map((dot) => (
            <div key={dot} className="h-1 w-1 rounded-full bg-white" />
          ))}
        </div>
        <div className="relative flex items-center gap-4 px-5 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-white/[0.06] text-white/80">
            <Star
              size={20}
              className={cn(
                hasStarred ? "fill-amber-400 text-amber-400" : "text-white/70",
              )}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-white">
              {hasStarred
                ? t("settings.general.githubStarred")
                : t("settings.general.githubTitle")}
            </div>
            <div className="text-[12px] text-white/55">
              {hasStarred
                ? t("settings.general.githubStarredBody")
                : t("settings.general.githubBody")}
            </div>
          </div>
          {hasStarred ? (
            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-[12px] font-medium text-amber-400">
              <Star size={12} className="fill-amber-400" />
              {t("settings.general.githubStarredBadge")}
            </div>
          ) : (
            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/20 bg-white/[0.08] px-3 py-1.5 text-[12px] font-medium text-white/90 backdrop-blur-sm transition-all group-hover:bg-white group-hover:text-text-primary">
              <Star size={12} className="text-amber-400" />
              {t("settings.general.githubBadge")}
            </div>
          )}
        </div>
      </button>

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

// ── Current Model Selector ────────────────────────────────────

function _CurrentModelSelector({
  models,
  currentModelId,
  onSelectModel,
}: {
  models: Array<{ id: string; name: string; provider: string }>;
  currentModelId: string;
  onSelectModel: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const currentModel = models.find((m) => m.id === currentModelId);
  const currentGroupKey = currentModel ? getGroupKey(currentModel) : "";

  // Group models by provider
  const modelsByProvider = useMemo(() => {
    const map = new Map<string, typeof models>();
    for (const m of models) {
      const groupKey = getGroupKey(m);
      const list = map.get(groupKey) ?? [];
      list.push(m);
      map.set(groupKey, list);
    }
    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      if (a[0] === "nexu") return -1;
      if (b[0] === "nexu") return 1;
      return 0;
    });
    return entries.map(([provider, ms]) => ({
      id: provider,
      name: PROVIDER_LABELS[provider] ?? provider,
      models: ms,
    }));
  }, [models]);

  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    () => new Set(currentGroupKey ? [currentGroupKey] : []),
  );

  // Expand current model's provider when opened
  useEffect(() => {
    if (open) {
      const groupKey = currentModel ? getGroupKey(currentModel) : "";
      setExpandedProviders(
        new Set(
          groupKey
            ? [groupKey]
            : modelsByProvider.length > 0 && modelsByProvider[0]
              ? [modelsByProvider[0].id]
              : [],
        ),
      );
    }
  }, [open, currentModel, modelsByProvider]);

  // Empty state
  if (models.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-surface-0 px-4 py-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-2 shrink-0">
            <Cpu size={16} className="text-text-muted" />
          </div>
          <div>
            <div className="text-[13px] font-medium text-text-primary">
              {t("models.noModelConfigured")}
            </div>
            <div className="text-[11px] text-text-muted">
              {t("models.configureProviderHint")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const query = search.toLowerCase().trim();
  const filteredProviders = modelsByProvider
    .map((p) => ({
      ...p,
      models: p.models.filter(
        (m) =>
          !query ||
          m.name.toLowerCase().includes(query) ||
          p.name.toLowerCase().includes(query),
      ),
    }))
    .filter((p) => p.models.length > 0);

  return (
    <div className="relative mb-8" ref={ref}>
      <div className="rounded-xl border border-border bg-surface-1 px-4 py-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/10 to-accent/5 flex items-center justify-center shrink-0">
              <Cpu size={16} className="text-accent" />
            </div>
            <div>
              <div className="text-[13px] font-semibold text-text-primary">
                {t("models.currentModel")}
              </div>
              <div className="text-[11px] text-text-tertiary">
                {t("models.configureProviderHint")}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-surface-0 hover:bg-surface-2 hover:border-border-hover transition-all text-[12px] font-medium text-text-primary"
          >
            {currentModel ? (
              <>
                <span className="w-4 h-4 shrink-0 flex items-center justify-center">
                  <ProviderLogo provider={currentGroupKey} size={14} />
                </span>
                {currentModel.name}
              </>
            ) : (
              <span className="text-text-muted">
                {currentModelId || t("models.noModelConfigured")}
              </span>
            )}
            <ChevronDown size={13} className="text-text-muted" />
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 z-20 mt-1 rounded-xl border border-border bg-surface-0 shadow-lg overflow-hidden">
          {/* Search */}
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center gap-2.5 rounded-lg bg-surface-0 border border-border px-3 py-2">
              <Search size={14} className="text-text-muted shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  if (e.target.value.trim()) {
                    setExpandedProviders(
                      new Set(modelsByProvider.map((p) => p.id)),
                    );
                  }
                }}
                placeholder={t("models.searchModels")}
                className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-muted/50 outline-none"
              />
            </div>
          </div>

          {/* Provider groups */}
          <div className="max-h-[320px] overflow-y-auto">
            {filteredProviders.length === 0 ? (
              <div className="px-4 py-8 text-center text-[13px] text-text-muted">
                {t("models.byok.none")}
              </div>
            ) : (
              filteredProviders.map((provider) => {
                const isExpanded =
                  expandedProviders.has(provider.id) || !!query;
                return (
                  <div key={provider.id}>
                    <div className="px-3 pt-2.5 pb-1 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider sticky top-0 bg-surface-0">
                      {provider.name}
                    </div>
                    {isExpanded &&
                      provider.models.map((model) => {
                        const isSelected = model.id === currentModelId;
                        return (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => {
                              onSelectModel(model.id);
                              setOpen(false);
                              setSearch("");
                            }}
                            className={cn(
                              "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                              isSelected ? "bg-accent/5" : "hover:bg-surface-2",
                            )}
                          >
                            <span className="w-5 h-5 shrink-0 flex items-center justify-center">
                              <ProviderLogo provider={provider.id} size={14} />
                            </span>
                            <div className="flex-1 min-w-0">
                              <div
                                className={cn(
                                  "text-[12px] truncate",
                                  isSelected
                                    ? "font-semibold text-accent"
                                    : "font-medium text-text-primary",
                                )}
                              >
                                {model.name}
                              </div>
                              <div className="text-[10px] text-text-tertiary">
                                {provider.name}
                              </div>
                            </div>
                            {isSelected && (
                              <Check
                                size={14}
                                className="text-accent shrink-0"
                              />
                            )}
                          </button>
                        );
                      })}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ModelsPage() {
  const { t } = useTranslation();
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
    onSuccess: () => {
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
      name: "Nexu Official",
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
        configured: db?.hasApiKey ?? false,
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-2 pb-6 sm:pb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="heading-page">{t("models.pageTitle")}</h2>
            <p className="heading-page-desc">{t("models.pageSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface-0 hover:bg-surface-1 hover:border-border-hover transition-all text-[12px] font-medium text-text-secondary hover:text-text-primary"
            >
              <Star
                size={13}
                className="text-amber-400 group-hover:fill-amber-400 transition-colors"
              />
              Star
            </a>
            <button
              type="button"
              onClick={() =>
                window.open(GITHUB_URL, "_blank", "noopener,noreferrer")
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-[12px] font-medium text-text-primary hover:border-border-hover hover:bg-surface-1 transition-colors"
            >
              <FolderOpen size={13} />
              Workspace
              <ArrowUpRight size={12} className="text-text-muted" />
            </button>
          </div>
        </div>

        {/* Nexu Bot Model selector */}
        {models.length > 0 && (
          <_CurrentModelSelector
            models={models}
            currentModelId={currentModelId}
            onSelectModel={(modelId) => updateModel.mutate(modelId)}
          />
        )}

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
                      <span className="w-5 h-5 shrink-0 flex items-center justify-center">
                        <ProviderLogo provider={item.id} size={16} />
                      </span>
                      <span
                        className={cn(
                          "flex-1 text-[12px] font-medium truncate",
                          isActive ? "text-accent" : "text-text-primary",
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
                    />
                  )
                ) : (
                  <ByokProviderDetail
                    providerId={activeProvider.id}
                    dbProvider={dbProviders.find(
                      (p) => p.providerId === activeProvider.id,
                    )}
                    queryClient={queryClient}
                    currentModelId={currentModelId}
                    onAutoSelectModel={handleAutoSelectModel}
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

// ── Link catalog types ─────────────────────────────────────────

interface LinkModel {
  id: string;
  name: string;
  externalName: string;
  inputPrice: string | null;
  outputPrice: string | null;
}

interface LinkProvider {
  id: string;
  name: string;
  kind: string;
  models: LinkModel[];
}

async function fetchLinkCatalog(): Promise<LinkProvider[]> {
  const { data } = await getApiV1LinkCatalog();
  return (data?.providers as LinkProvider[]) ?? [];
}

// ── Managed provider detail (Nexu Official) ───────────────────

function ManagedProviderDetail({
  provider,
  currentModelId,
}: {
  provider: ProviderConfig;
  currentModelId: string;
}) {
  const { t } = useTranslation();
  const { data: linkProviders = [], isLoading: catalogLoading } = useQuery({
    queryKey: ["link-catalog"],
    queryFn: fetchLinkCatalog,
  });

  const totalModels = linkProviders.reduce(
    (sum, p) => sum + p.models.length,
    0,
  );

  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [cloudConnected, setCloudConnected] = useState(false);
  const queryClient = useQueryClient();

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
          // Refresh provider/model data now that cloud is connected.
          // Backend onCloudStateChanged callback already ran
          // ensureValidDefaultModel + syncAll at this point.
          queryClient.invalidateQueries({ queryKey: ["link-catalog"] });
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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-2 shrink-0">
            <ProviderLogo provider={provider.id} size={20} />
          </span>
          <div>
            <div className="text-[14px] font-semibold text-text-primary">
              {provider.name}
            </div>
            <div className="text-[11px] text-text-tertiary">
              {t(provider.description)}
            </div>
          </div>
        </div>
        <div
          className={cn(
            "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-medium",
            cloudConnected
              ? "border border-emerald-500/20 bg-emerald-500/8 text-emerald-600"
              : "border border-accent/20 bg-accent/8 text-accent",
          )}
        >
          {cloudConnected
            ? t("models.managed.connected")
            : t("models.managed.loginRequired")}
        </div>
      </div>

      {/* Login / connected card */}
      {cloudConnected ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center">
                <Check size={12} className="text-emerald-500" />
              </div>
              <div className="text-[13px] font-semibold text-emerald-600">
                {t("models.managed.cloudConnected")}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ["link-catalog"] });
                }}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors cursor-pointer"
              >
                <RefreshCw size={11} />
                {t("models.managed.refresh")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await postApiInternalDesktopCloudDisconnect().catch(() => {});
                  setCloudConnected(false);
                  queryClient.invalidateQueries({ queryKey: ["models"] });
                  queryClient.invalidateQueries({
                    queryKey: ["desktop-default-model"],
                  });
                }}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-red-500/70 hover:text-red-500 hover:bg-red-500/5 transition-colors cursor-pointer"
              >
                {t("models.managed.disconnect")}
              </button>
            </div>
          </div>
          <div className="text-[12px] text-text-secondary mt-1.5">
            {t("models.managed.cloudModelsAvailable")}
          </div>
        </div>
      ) : (
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

      {/* Connected cloud models (from API) — read-only */}
      {provider.models.length > 0 && (
        <div className="mb-6">
          <div className="text-[13px] font-semibold text-text-primary mb-3">
            {t("models.managed.availableModels")}
            <span className="ml-2 text-[11px] font-normal text-text-muted">
              {t("models.managed.totalCount", {
                count: provider.models.length,
              })}
            </span>
          </div>
          <div className="space-y-1.5">
            {provider.models.map((model) => {
              const isSelected = model.id === currentModelId;
              return (
                <div
                  key={model.id}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
                    isSelected
                      ? "border-accent/30 bg-accent/5"
                      : "border-border bg-surface-0",
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0">
                      <ProviderLogo provider={provider.id} size={16} />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-text-primary truncate">
                        {model.name}
                      </div>
                      <div className="text-[10px] text-text-muted">
                        {model.id}
                      </div>
                    </div>
                  </div>
                  {isSelected && (
                    <Check size={14} className="text-accent shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Link provider catalog */}
      {catalogLoading ? (
        <div className="flex items-center gap-2 text-[12px] text-text-muted py-4">
          <Loader2 size={14} className="animate-spin" />
          {t("models.managed.loadingCatalog")}
        </div>
      ) : linkProviders.length > 0 ? (
        <LinkModelCatalog
          linkProviders={linkProviders}
          totalModels={totalModels}
          cloudConnected={cloudConnected}
          currentModelId={currentModelId}
        />
      ) : null}
    </div>
  );
}

// ── Link model catalog (read-only) ───────────────────────────

function LinkModelCatalog({
  linkProviders,
  totalModels,
  cloudConnected,
  currentModelId,
}: {
  linkProviders: LinkProvider[];
  totalModels: number;
  cloudConnected: boolean;
  currentModelId: string;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <div className="text-[13px] font-semibold text-text-primary mb-1">
        {t("models.catalog.title")}
        <span className="ml-2 text-[11px] font-normal text-text-muted">
          {t("models.catalog.summary", {
            totalModels,
            providerCount: linkProviders.length,
          })}
        </span>
      </div>
      <div className="text-[11px] text-text-muted mb-4">
        {cloudConnected
          ? t("models.catalog.connectedHint")
          : t("models.catalog.loginHint")}
      </div>
      <div className="space-y-5">
        {linkProviders.map((lp) => (
          <div key={lp.id}>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-4 h-4 rounded flex items-center justify-center shrink-0">
                <ProviderLogo provider={lp.kind} size={14} />
              </span>
              <span className="text-[12px] font-medium text-text-primary">
                {lp.name}
              </span>
              <span className="text-[10px] text-text-muted">
                {t("models.catalog.modelsCount", { count: lp.models.length })}
              </span>
            </div>
            <div className="space-y-1.5">
              {lp.models.map((m) => {
                const isSelected = m.id === currentModelId;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
                      isSelected
                        ? "border-accent/30 bg-accent/5"
                        : "border-border bg-surface-0",
                      !cloudConnected && "opacity-70",
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0">
                        <ProviderLogo provider={lp.kind} size={16} />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-text-primary truncate">
                          {m.name}
                        </div>
                        <div className="text-[10px] text-text-muted">
                          {m.externalName}
                        </div>
                      </div>
                    </div>
                    {isSelected ? (
                      <Check size={14} className="text-accent shrink-0" />
                    ) : !cloudConnected ? (
                      <span className="text-[10px] text-text-muted/60 shrink-0">
                        {t("models.catalog.loginToUse")}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
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
}: {
  providerId: string;
  dbProvider?: DbProvider;
  queryClient: ReturnType<typeof useQueryClient>;
  currentModelId: string;
  onAutoSelectModel: (modelId: string) => void;
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
  const [isEditingApiKey, setIsEditingApiKey] = useState(
    !dbProvider?.hasApiKey,
  );

  // Available models from verification
  const [verifiedModels, setVerifiedModels] = useState<string[] | null>(null);

  // Reset form when provider changes
  useEffect(() => {
    setApiKey("");
    setBaseUrl(dbProvider?.baseUrl ?? meta.defaultProxyUrl ?? "");
    setIsEditingApiKey(!dbProvider?.hasApiKey);
    setVerifiedModels(null);
  }, [dbProvider, meta.defaultProxyUrl]);

  // ── Verify mutation ──────────────────────────────────
  const verifyMutation = useMutation({
    mutationFn: () => verifyApiKey(providerId, apiKey, baseUrl || undefined),
    onSuccess: (result) => {
      if (result.valid && result.models) {
        setVerifiedModels(result.models);
      }
    },
  });

  // ── Save mutation ────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      // Auto-fetch models if none available (e.g. custom provider without verify)
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
        modelsJson: JSON.stringify(models),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      setApiKey("");
      setIsEditingApiKey(false);
      markSetupComplete();
      // Auto-select first model if no model is currently selected
      const firstModel = displayModels[0];
      if (firstModel) {
        onAutoSelectModel(firstModel);
      }
    },
  });

  // ── Delete mutation ──────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: () => deleteProvider(providerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      setApiKey("");
      setBaseUrl(meta.defaultProxyUrl ?? "");
      setIsEditingApiKey(true);
      setVerifiedModels(null);
    },
  });

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

      {/* API Key + API Proxy URL */}
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

      {/* Action buttons — above model list */}
      <div className="flex items-center gap-3 mb-6">
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

        {dbProvider?.hasApiKey && (
          <button
            type="button"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (confirm(t("models.byok.confirmRemove"))) {
                deleteMutation.mutate();
              }
            }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-red-500 hover:bg-red-500/5 transition-colors"
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

      {saveMutation.isSuccess && (
        <div className="mb-4 text-[11px] text-emerald-600">
          {t("models.byok.saveSuccess")}
        </div>
      )}
      {saveMutation.isError && (
        <div className="mb-4 text-[11px] text-red-500">
          {t("models.byok.saveFailed")}
        </div>
      )}

      {/* Model list — read-only */}
      <div>
        <div className="text-[13px] font-semibold text-text-primary mb-3">
          {t("models.byok.modelList")}
          <span className="ml-2 text-[11px] font-normal text-text-muted">
            {t("models.byok.modelsTotalCount", { count: displayModels.length })}
          </span>
        </div>
        <div className="space-y-1.5">
          {displayModels.length === 0 && (
            <div className="text-[11px] text-text-muted/60 py-3 text-center">
              {t("models.byok.none")}
            </div>
          )}
          {displayModels.map((modelId) => {
            const isSelected = modelId === currentModelId;
            return (
              <div
                key={modelId}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
                  isSelected
                    ? "border-accent/30 bg-accent/5"
                    : "border-border bg-surface-0",
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0">
                    <ProviderLogo provider={providerId} size={16} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-text-primary truncate">
                      {modelId}
                    </div>
                    <div className="text-[10px] text-text-muted">
                      {providerId}
                    </div>
                  </div>
                </div>
                {isSelected && (
                  <Check size={14} className="text-accent shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
