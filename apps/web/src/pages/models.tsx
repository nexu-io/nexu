import { ProviderLogo } from "@/components/provider-logo";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getApiV1Models } from "../../lib/api/sdk.gen";
import { markSetupComplete } from "./welcome";

// ── Toggle Switch 组件 ─────────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
        checked ? "bg-emerald-500" : "bg-surface-3",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[3px]",
        )}
      />
    </button>
  );
}

// ── Types ──────────────────────────────────────────────────────

interface ProviderModel {
  id: string;
  name: string;
  enabled: boolean;
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

// ── Provider metadata ─────────────────────────────────────────

const PROVIDER_META: Record<
  string,
  {
    name: string;
    description: string;
    apiDocsUrl?: string;
    apiKeyPlaceholder?: string;
    defaultProxyUrl?: string;
  }
> = {
  nexu: {
    name: "Nexu Official",
    description: "登录后使用 Nexu 官方高级模型，无需单独配置 API Key",
  },
  anthropic: {
    name: "Anthropic",
    description: "Claude 系列 AI 模型",
    apiDocsUrl: "https://console.anthropic.com/settings/keys",
    apiKeyPlaceholder: "sk-ant-api03-...",
    defaultProxyUrl: "https://api.anthropic.com",
  },
  openai: {
    name: "OpenAI",
    description: "GPT 系列 AI 模型",
    apiDocsUrl: "https://platform.openai.com/api-keys",
    apiKeyPlaceholder: "sk-...",
    defaultProxyUrl: "https://api.openai.com/v1",
  },
  google: {
    name: "Google AI",
    description: "Gemini 系列 AI 模型",
    apiDocsUrl: "https://aistudio.google.com/app/apikey",
    apiKeyPlaceholder: "AIza...",
    defaultProxyUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  custom: {
    name: "自定义服务商",
    description: "任何兼容 OpenAI 的 API 端点",
    apiKeyPlaceholder: "your-api-key",
  },
};

// Well-known models per provider (shown as toggles when no verify result yet)
const DEFAULT_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-haiku-4-5-20251001",
  ],
  openai: ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"],
  google: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
};

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
      enabled: true,
      description: m.description,
    });
    grouped.set(m.provider, list);
  }

  return Array.from(grouped.entries()).map(([providerId, models]) => {
    const meta = PROVIDER_META[providerId] ?? {
      name: providerId,
      description: "",
    };
    return {
      id: providerId,
      name: meta.name,
      description: meta.description,
      managed: providerId === "nexu",
      apiDocsUrl: meta.apiDocsUrl,
      models,
    };
  });
}

// ── API helpers ───────────────────────────────────────────────

async function fetchProviders(): Promise<DbProvider[]> {
  const res = await fetch("/api/v1/providers");
  if (!res.ok) return [];
  const data = (await res.json()) as { providers: DbProvider[] };
  return data.providers ?? [];
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
  const res = await fetch(`/api/v1/providers/${providerId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to save provider: ${res.status}`);
  const data = (await res.json()) as { provider: DbProvider };
  return data.provider;
}

async function deleteProvider(providerId: string): Promise<void> {
  const res = await fetch(`/api/v1/providers/${providerId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete provider: ${res.status}`);
}

async function verifyApiKey(
  providerId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ valid: boolean; models?: string[]; error?: string }> {
  const res = await fetch(`/api/v1/providers/${providerId}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, baseUrl }),
  });
  if (!res.ok) throw new Error(`Verify request failed: ${res.status}`);
  return res.json();
}

// ── BYOK provider sidebar entries ─────────────────────────────
// Always show these four as configurable, even if no key set yet

const BYOK_PROVIDER_IDS = ["anthropic", "openai", "google", "custom"] as const;

// ── Component ──────────────────────────────────────────────────

export function ModelsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isSetupMode = searchParams.get("setup") === "1";
  const [_search, _setSearch] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    isSetupMode ? "anthropic" : null,
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

  const providers = useMemo(
    () => buildProviders(modelsData?.models ?? []),
    [modelsData],
  );

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

  // Split sidebar items into enabled/disabled groups
  const enabledProviders = useMemo(
    () => sidebarItems.filter((p) => p.configured),
    [sidebarItems],
  );
  const disabledProviders = useMemo(
    () => sidebarItems.filter((p) => !p.configured),
    [sidebarItems],
  );

  const activeProvider =
    sidebarItems.find((p) => p.id === selectedProviderId) ??
    sidebarItems[0] ??
    null;

  // Clear setup param once user interacts
  const clearSetupParam = useCallback(() => {
    if (isSetupMode) {
      setSearchParams({}, { replace: true });
    }
  }, [isSetupMode, setSearchParams]);

  if (modelsLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[13px] text-text-muted">Loading models...</div>
      </div>
    );
  }

  if (modelsError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-[13px] text-red-500 mb-2">
            Failed to load models
          </div>
          <p className="text-[12px] text-text-muted">
            Check that you are logged in and the API server is running.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h2 className="text-[18px] font-semibold text-text-primary mb-1">
          设置
        </h2>
        <p className="text-[12px] text-text-muted mb-5">管理 AI 模型服务商</p>

        {/* Main container */}
        <div
          className="flex gap-0 rounded-xl border border-border bg-surface-1 overflow-hidden"
          style={{ minHeight: 520 }}
        >
          {/* Left sidebar — provider list grouped */}
          <div className="w-56 shrink-0 border-r border-border bg-surface-0 overflow-y-auto">
            <div className="p-2">
              {/* 已启用 group */}
              {enabledProviders.length > 0 && (
                <>
                  <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    已启用
                  </div>
                  <div className="space-y-0.5 mb-3">
                    {enabledProviders.map((item) => {
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
                            isActive ? "bg-accent/10" : "hover:bg-surface-2",
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
                          <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-500" />
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* 未启用 group */}
              {disabledProviders.length > 0 && (
                <>
                  <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                    未启用
                  </div>
                  <div className="space-y-0.5">
                    {disabledProviders.map((item) => {
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
                            isActive ? "bg-accent/10" : "hover:bg-surface-2",
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
                </>
              )}
            </div>
          </div>

          {/* Right panel — provider detail */}
          <div className="flex-1 overflow-y-auto p-5">
            {activeProvider ? (
              activeProvider.managed ? (
                <ManagedProviderDetail
                  provider={
                    providers.find((p) => p.id === activeProvider.id) ?? {
                      id: activeProvider.id,
                      name: activeProvider.name,
                      description:
                        PROVIDER_META[activeProvider.id]?.description ?? "",
                      managed: true,
                      models: [],
                    }
                  }
                />
              ) : (
                <ByokProviderDetail
                  providerId={activeProvider.id}
                  dbProvider={dbProviders.find(
                    (p) => p.providerId === activeProvider.id,
                  )}
                  models={
                    providers.find((p) => p.id === activeProvider.id)?.models ??
                    []
                  }
                  queryClient={queryClient}
                />
              )
            ) : (
              <div className="flex items-center justify-center h-full text-[13px] text-text-muted">
                选择一个服务商
              </div>
            )}
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
  const res = await fetch("/api/v1/link-catalog");
  if (!res.ok) return [];
  const data = (await res.json()) as { providers: LinkProvider[] };
  return data.providers ?? [];
}

// ── Managed provider detail (Nexu Official) ───────────────────

function ManagedProviderDetail({ provider }: { provider: ProviderConfig }) {
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
    fetch("/api/internal/desktop/cloud-status")
      .then((res) => res.json())
      .then((data: { connected: boolean }) => {
        if (data.connected) setCloudConnected(true);
      })
      .catch(() => {});
  }, []);

  // Poll cloud-status while waiting for browser login
  useEffect(() => {
    if (!loginBusy) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/internal/desktop/cloud-status");
        const data = (await res.json()) as {
          connected: boolean;
          userEmail?: string;
        };
        if (data.connected) {
          setLoginBusy(false);
          setCloudConnected(true);
          // Refresh provider/model data now that cloud is connected
          queryClient.invalidateQueries({ queryKey: ["link-catalog"] });
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
      const res = await fetch("/api/internal/desktop/cloud-connect", {
        method: "POST",
      });
      const data = (await res.json()) as {
        browserUrl?: string;
        error?: string;
      };
      if (!res.ok) {
        setLoginError(data.error ?? "连接失败，请稍后重试");
        setLoginBusy(false);
        return;
      }
      if (data.browserUrl) {
        // In Electron, window.open is intercepted by the main process and
        // opened in the system browser via shell.openExternal().
        window.open(data.browserUrl, "_blank");
      }
      // Keep loginBusy=true — polling effect will detect completion.
    } catch {
      setLoginError("无法连接到 Nexu 云端服务");
      setLoginBusy(false);
    }
  };

  const handleCancelLogin = async () => {
    try {
      await fetch("/api/internal/desktop/cloud-disconnect", { method: "POST" });
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
            <div className="text-[15px] font-semibold text-text-primary">
              {provider.name}
            </div>
            <div className="text-[11px] text-text-muted">
              {provider.description}
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
          {cloudConnected ? "已连接" : "登录后可用"}
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
                已连接 Nexu 云端
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
                刷新
              </button>
              <button
                type="button"
                onClick={async () => {
                  await fetch("/api/internal/desktop/cloud-disconnect", {
                    method: "POST",
                  }).catch(() => {});
                  setCloudConnected(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium text-red-500/70 hover:text-red-500 hover:bg-red-500/5 transition-colors cursor-pointer"
              >
                断开
              </button>
            </div>
          </div>
          <div className="text-[12px] text-text-secondary mt-1.5">
            云端模型已可用，可在下方查看和管理。
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-accent/15 bg-accent/5 px-4 py-4 mb-6">
          <div className="text-[13px] font-semibold text-accent">
            登录后使用 Nexu 官方模型
          </div>
          <div className="text-[12px] leading-[1.7] text-text-secondary mt-1.5">
            登录 Nexu 账号后，即可直接使用官方提供的高级模型，无需单独配置 API
            Key。
          </div>
          {loginBusy ? (
            <div className="mt-4 flex items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-lg bg-accent/80 px-3.5 py-2 text-[12px] font-medium text-white">
                <Loader2 size={13} className="animate-spin" />
                等待浏览器登录...
              </div>
              <button
                type="button"
                onClick={() => void handleCancelLogin()}
                className="text-[12px] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handleLogin()}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[12px] font-medium text-white transition-colors hover:bg-accent/90 cursor-pointer"
            >
              登录 Nexu 账号
              <ArrowUpRight size={13} />
            </button>
          )}
          {loginError && (
            <p className="mt-2 text-[11px] text-red-500">{loginError}</p>
          )}
        </div>
      )}

      {/* Connected cloud models (from API) */}
      {provider.models.length > 0 && (
        <div className="mb-6">
          <div className="text-[13px] font-semibold text-text-primary mb-3">
            已启用模型
            <span className="ml-2 text-[11px] font-normal text-text-muted">
              共 {provider.models.length} 个
            </span>
          </div>
          <div className="space-y-1.5">
            {provider.models.map((model) => (
              <div
                key={model.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-0 px-3 py-2.5"
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
                <ToggleSwitch checked={model.enabled} onChange={() => {}} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Link provider catalog */}
      {catalogLoading ? (
        <div className="flex items-center gap-2 text-[12px] text-text-muted py-4">
          <Loader2 size={14} className="animate-spin" />
          加载模型目录...
        </div>
      ) : linkProviders.length > 0 ? (
        <LinkModelCatalog
          linkProviders={linkProviders}
          totalModels={totalModels}
          cloudConnected={cloudConnected}
        />
      ) : null}
    </div>
  );
}

// ── Link model catalog with toggles ──────────────────────────

function LinkModelCatalog({
  linkProviders,
  totalModels,
  cloudConnected,
}: {
  linkProviders: LinkProvider[];
  totalModels: number;
  cloudConnected: boolean;
}) {
  // All link model IDs, flattened
  const allModelIds = useMemo(
    () => linkProviders.flatMap((lp) => lp.models.map((m) => m.id)),
    [linkProviders],
  );

  // Enabled set — defaults to all enabled when connected
  const [enabledIds, setEnabledIds] = useState<Set<string>>(
    () => new Set(allModelIds),
  );
  const [_saving, setSaving] = useState(false);

  // Sync when catalog changes
  useEffect(() => {
    setEnabledIds(new Set(allModelIds));
  }, [allModelIds]);

  // Persist enabled model selection to backend
  const persistEnabledModels = useCallback(async (ids: Set<string>) => {
    setSaving(true);
    try {
      await fetch("/api/internal/desktop/cloud-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabledModelIds: Array.from(ids) }),
      });
    } catch {
      /* best-effort */
    } finally {
      setSaving(false);
    }
  }, []);

  const toggleModel = (id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persistEnabledModels(next);
      return next;
    });
  };

  return (
    <div>
      <div className="text-[13px] font-semibold text-text-primary mb-1">
        可用模型目录
        <span className="ml-2 text-[11px] font-normal text-text-muted">
          共 {totalModels} 个模型，来自 {linkProviders.length} 个服务商
        </span>
      </div>
      <div className="text-[11px] text-text-muted mb-4">
        {cloudConnected
          ? "开启开关后，模型将出现在对话的模型选择列表中"
          : "以下模型在登录 Nexu 账号后即可使用"}
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
                {lp.models.length} 个模型
              </span>
            </div>
            <div className="space-y-1.5">
              {lp.models.map((m) => {
                const enabled = enabledIds.has(m.id);
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-0 px-3 py-2.5",
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
                    {cloudConnected ? (
                      <ToggleSwitch
                        checked={enabled}
                        onChange={() => toggleModel(m.id)}
                      />
                    ) : (
                      <span className="text-[10px] text-text-muted/60 shrink-0">
                        登录后可用
                      </span>
                    )}
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
  models: _models,
  queryClient,
}: {
  providerId: string;
  dbProvider?: DbProvider;
  models: ProviderModel[];
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const meta = PROVIDER_META[providerId] ?? {
    name: providerId,
    description: "",
    apiDocsUrl: undefined,
    apiKeyPlaceholder: "your-api-key",
    defaultProxyUrl: "",
  };

  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    dbProvider?.baseUrl ?? meta.defaultProxyUrl ?? "",
  );
  const [providerEnabled, setProviderEnabled] = useState(
    dbProvider?.hasApiKey ?? false,
  );

  // Available models from verification
  const [verifiedModels, setVerifiedModels] = useState<string[] | null>(null);
  const [enabledModelIds, setEnabledModelIds] = useState<Set<string>>(
    () => new Set(JSON.parse(dbProvider?.modelsJson ?? "[]")),
  );

  // Reset form when provider changes
  useEffect(() => {
    setApiKey("");
    setBaseUrl(dbProvider?.baseUrl ?? meta.defaultProxyUrl ?? "");
    setProviderEnabled(dbProvider?.hasApiKey ?? false);
    setVerifiedModels(null);
    setEnabledModelIds(new Set(JSON.parse(dbProvider?.modelsJson ?? "[]")));
  }, [dbProvider, meta.defaultProxyUrl]);

  // ── Verify mutation ──────────────────────────────────
  const verifyMutation = useMutation({
    mutationFn: () => verifyApiKey(providerId, apiKey, baseUrl || undefined),
    onSuccess: (result) => {
      if (result.valid && result.models) {
        setVerifiedModels(result.models);
        // Auto-enable all verified models
        setEnabledModelIds(new Set(result.models));
        setProviderEnabled(true);
      }
    },
  });

  // ── Save mutation ────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () =>
      saveProvider(providerId, {
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || null,
        displayName: meta.name,
        enabled: providerEnabled,
        modelsJson: JSON.stringify(Array.from(enabledModelIds)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers"] });
      queryClient.invalidateQueries({ queryKey: ["models"] });
      setApiKey("");
      markSetupComplete();
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
      setVerifiedModels(null);
      setEnabledModelIds(new Set());
      setProviderEnabled(false);
    },
  });

  // Model list to show: verified > DB stored > defaults
  const displayModels = useMemo(() => {
    if (verifiedModels && verifiedModels.length > 0) return verifiedModels;
    const stored: string[] = JSON.parse(dbProvider?.modelsJson ?? "[]");
    if (stored.length > 0) return stored;
    return DEFAULT_MODELS[providerId] ?? [];
  }, [verifiedModels, dbProvider, providerId]);

  // Split into enabled/disabled
  const enabledModels = displayModels.filter((m) => enabledModelIds.has(m));
  const disabledModels = displayModels.filter((m) => !enabledModelIds.has(m));

  const toggleModel = (modelId: string) => {
    setEnabledModelIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

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
              <div className="text-[15px] font-semibold text-text-primary">
                {meta.name}
              </div>
              {meta.apiDocsUrl && (
                <a
                  href={meta.apiDocsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-accent hover:text-accent/80 transition-colors flex items-center gap-0.5"
                >
                  获取 API Key
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
            <div className="text-[11px] text-text-muted">
              {meta.description}
            </div>
          </div>
        </div>
        <ToggleSwitch
          checked={providerEnabled}
          onChange={(v) => setProviderEnabled(v)}
        />
      </div>

      {/* API Key + API 代理地址 */}
      <div className="space-y-4 mb-6">
        <div>
          <label
            htmlFor={`apikey-${providerId}`}
            className="block text-[12px] font-medium text-text-secondary mb-1.5"
          >
            API Key
            {dbProvider?.hasApiKey && (
              <span className="ml-2 text-emerald-600 font-normal text-[10px]">
                (已保存)
              </span>
            )}
          </label>
          <div className="flex gap-2">
            <input
              id={`apikey-${providerId}`}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={meta.apiKeyPlaceholder}
              className="flex-1 rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30"
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
                "检查"
              )}
            </button>
          </div>
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
                ? `密钥有效 — 检测到 ${verifyMutation.data.models?.length ?? 0} 个模型`
                : `密钥无效: ${verifyMutation.data?.error ?? "未知错误"}`}
            </div>
          )}
        </div>
        <div>
          <label
            htmlFor={`baseurl-${providerId}`}
            className="block text-[12px] font-medium text-text-secondary mb-1.5"
          >
            API 代理地址
          </label>
          <input
            id={`baseurl-${providerId}`}
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={meta.defaultProxyUrl || "https://api.example.com/v1"}
            className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/30"
          />
        </div>
      </div>

      {/* Model list */}
      <div>
        <div className="text-[13px] font-semibold text-text-primary mb-3">
          模型列表
          <span className="ml-2 text-[11px] font-normal text-text-muted">
            共 {displayModels.length} 个模型
          </span>
        </div>
        <div className="space-y-4">
          {/* 已启用 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-medium text-text-muted">
                已启用
              </span>
              <span className="text-[10px] text-text-muted/60">
                启用后将出现在 Nexu 的模型选择列表中
              </span>
            </div>
            <div className="space-y-1.5">
              {enabledModels.length === 0 && (
                <div className="text-[11px] text-text-muted/60 py-3 text-center">
                  暂无
                </div>
              )}
              {enabledModels.map((modelId) => (
                <div
                  key={modelId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-0 px-3 py-2.5"
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
                  <ToggleSwitch
                    checked={true}
                    onChange={() => toggleModel(modelId)}
                  />
                </div>
              ))}
            </div>
          </div>
          {/* 未启用 */}
          <div>
            <div className="text-[11px] font-medium text-text-muted mb-2">
              未启用
            </div>
            <div className="space-y-1.5">
              {disabledModels.length === 0 && (
                <div className="text-[11px] text-text-muted/60 py-3 text-center">
                  暂无
                </div>
              )}
              {disabledModels.map((modelId) => (
                <div
                  key={modelId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-0 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 opacity-50">
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
                  <ToggleSwitch
                    checked={false}
                    onChange={() => toggleModel(modelId)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 mt-6">
        <button
          type="button"
          disabled={
            saveMutation.isPending ||
            (!apiKey && !dbProvider?.hasApiKey) ||
            enabledModelIds.size === 0
          }
          onClick={() => saveMutation.mutate()}
          className={cn(
            "flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-medium transition-colors",
            !saveMutation.isPending &&
              (apiKey || dbProvider?.hasApiKey) &&
              enabledModelIds.size > 0
              ? "bg-accent text-white hover:bg-accent/90"
              : "bg-surface-2 text-text-muted cursor-not-allowed",
          )}
        >
          {saveMutation.isPending && (
            <Loader2 size={13} className="animate-spin" />
          )}
          {dbProvider?.hasApiKey ? "更新配置" : "保存并启用"}
        </button>

        {dbProvider?.hasApiKey && (
          <button
            type="button"
            disabled={deleteMutation.isPending}
            onClick={() => {
              if (confirm("确定要移除此服务商配置吗？")) {
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
            移除
          </button>
        )}
      </div>

      {saveMutation.isSuccess && (
        <div className="mt-3 text-[11px] text-emerald-600">保存成功</div>
      )}
      {saveMutation.isError && (
        <div className="mt-3 text-[11px] text-red-500">保存失败，请重试</div>
      )}
    </div>
  );
}
