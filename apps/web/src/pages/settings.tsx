import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Cpu,
  ExternalLink,
  Loader2,
  Save,
  Settings as SettingsIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import "@/lib/api";
import {
  getApiV1OpenclawModelSettings,
  putApiV1OpenclawModelSettings,
} from "../../lib/api/sdk.gen";
import {
  OPENCLAW_PROVIDER_CATALOG,
  type ProviderCatalogEntry,
} from "../lib/openclaw-provider-catalog";

type SettingsTab = "general" | "providers";

interface ProviderFormState {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  apiKeyConfigured: boolean;
  models: Array<{
    id: string;
    name: string;
    enabled: boolean;
  }>;
}

type ProviderFormMap = Record<string, ProviderFormState>;

function buildInitialProviders(
  settings:
    | Awaited<ReturnType<typeof getApiV1OpenclawModelSettings>>["data"]
    | undefined,
): ProviderFormMap {
  return Object.fromEntries(
    OPENCLAW_PROVIDER_CATALOG.map((provider) => {
      const saved = settings?.providers?.[provider.id];
      const savedModels = new Map(
        (saved?.models ?? []).map((model) => [model.id, model]),
      );

      return [
        provider.id,
        {
          enabled: saved?.enabled ?? false,
          baseUrl: saved?.baseUrl ?? "",
          apiKey: "",
          apiKeyConfigured: saved?.apiKeyConfigured ?? false,
          models: provider.models.map((model) => ({
            id: model.id,
            name: model.name,
            enabled: savedModels.get(model.id)?.enabled ?? false,
          })),
        },
      ];
    }),
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("providers");
  const [activeProviderId, setActiveProviderId] = useState(
    OPENCLAW_PROVIDER_CATALOG[0]?.id ?? "anthropic",
  );
  const [providers, setProviders] = useState<ProviderFormMap>({});

  const { data, isLoading } = useQuery({
    queryKey: ["openclaw-model-settings"],
    queryFn: async () => {
      const response = await getApiV1OpenclawModelSettings();
      return response.data;
    },
  });

  useEffect(() => {
    setProviders(buildInitialProviders(data));
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      return putApiV1OpenclawModelSettings({
        body: {
          providers: Object.fromEntries(
            Object.entries(providers).map(([providerId, provider]) => [
              providerId,
              {
                enabled: provider.enabled,
                ...(provider.baseUrl.trim()
                  ? { baseUrl: provider.baseUrl.trim() }
                  : {}),
                ...(provider.apiKey.trim()
                  ? { apiKey: provider.apiKey.trim() }
                  : {}),
                models: provider.models,
              },
            ]),
          ),
        },
      });
    },
    onSuccess: async () => {
      toast.success("OpenClaw 模型配置已保存并发布");
      const refreshed = await getApiV1OpenclawModelSettings();
      setProviders(buildInitialProviders(refreshed.data));
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "保存失败");
    },
  });

  const activeProvider =
    OPENCLAW_PROVIDER_CATALOG.find(
      (provider) => provider.id === activeProviderId,
    ) ?? OPENCLAW_PROVIDER_CATALOG[0];
  const activeState = providers[activeProvider?.id ?? ""] ?? {
    enabled: false,
    baseUrl: "",
    apiKey: "",
    apiKeyConfigured: false,
    models: [],
  };

  if (isLoading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold text-text-primary">
              设置
            </h1>
            <p className="mt-1 text-[12px] text-text-muted">
              管理 web sidecar 的 OpenClaw 通用配置和模型服务商。
            </p>
          </div>
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={
              saveMutation.isPending || Object.keys(providers).length === 0
            }
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            保存并热更新
          </button>
        </div>

        <div className="mb-6 flex items-center gap-2 border-b border-border pb-3">
          {[
            { id: "general", label: "通用", icon: SettingsIcon },
            { id: "providers", label: "AI 模型服务商", icon: Cpu },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                type="button"
                key={item.id}
                onClick={() => setTab(item.id as SettingsTab)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-text-muted hover:bg-surface-2 hover:text-text-primary",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {tab === "general" ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-surface-1 p-5">
              <div className="text-[13px] font-semibold text-text-primary">
                Gateway Pool
              </div>
              <div className="mt-2 text-[12px] text-text-muted">
                当前配置会写入 pool 级 OpenClaw sidecar 配置，并复用现有 gateway
                snapshot publish / hot reload 链路。
              </div>
              <div className="mt-4 rounded-xl border border-border bg-surface-0 px-4 py-3 text-[12px] text-text-secondary">
                当前 pool:{" "}
                <span className="font-medium text-text-primary">
                  {data?.poolId ?? "-"}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {tab === "providers" && activeProvider ? (
          <div className="overflow-hidden rounded-2xl border border-border bg-surface-1">
            <div className="flex min-h-[560px] flex-col md:flex-row">
              <div className="w-full shrink-0 border-b border-border bg-surface-0 md:w-64 md:border-b-0 md:border-r">
                <div className="p-2">
                  {OPENCLAW_PROVIDER_CATALOG.map((provider) => {
                    const state = providers[provider.id];
                    const isActive = provider.id === activeProvider.id;
                    return (
                      <button
                        type="button"
                        key={provider.id}
                        onClick={() => setActiveProviderId(provider.id)}
                        className={cn(
                          "mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                          isActive ? "bg-accent/10" : "hover:bg-surface-2",
                        )}
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-[12px] font-semibold text-text-primary">
                          {provider.badge}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "truncate text-[12px] font-medium",
                              isActive ? "text-accent" : "text-text-primary",
                            )}
                          >
                            {provider.name}
                          </div>
                          <div className="text-[10px] text-text-muted">
                            {state?.enabled ? "已启用" : "未启用"}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "h-2 w-2 shrink-0 rounded-full",
                            state?.enabled ? "bg-emerald-500" : "bg-border",
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 p-5">
                <ProviderDetail
                  provider={activeProvider}
                  state={activeState}
                  onChange={(nextState) =>
                    setProviders((current) => ({
                      ...current,
                      [activeProvider.id]: nextState,
                    }))
                  }
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProviderDetail({
  provider,
  state,
  onChange,
}: {
  provider: ProviderCatalogEntry;
  state: ProviderFormState;
  onChange: (state: ProviderFormState) => void;
}) {
  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[14px] font-semibold text-text-primary">
            {provider.badge}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="text-[15px] font-semibold text-text-primary">
                {provider.name}
              </div>
              <a
                href={provider.apiDocsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-accent transition-colors hover:text-accent-hover"
              >
                获取 API Key
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="mt-1 text-[11px] text-text-muted">
              {provider.description}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onChange({ ...state, enabled: !state.enabled })}
          className={cn(
            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
            state.enabled ? "bg-emerald-500" : "bg-surface-3",
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
              state.enabled ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
      </div>

      <div className="mb-6 space-y-4">
        <div>
          <label
            htmlFor={`${provider.id}-api-key`}
            className="mb-1.5 block text-[12px] font-medium text-text-secondary"
          >
            API Key
          </label>
          <input
            id={`${provider.id}-api-key`}
            type="password"
            value={state.apiKey}
            onChange={(event) =>
              onChange({ ...state, apiKey: event.target.value })
            }
            placeholder={
              state.apiKeyConfigured
                ? `${provider.apiKeyPlaceholder} (留空表示保留当前值)`
                : provider.apiKeyPlaceholder
            }
            className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted/50 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          {state.apiKeyConfigured ? (
            <div className="mt-1 text-[11px] text-text-muted">
              当前已配置 API Key，留空不会覆盖。
            </div>
          ) : null}
        </div>

        <div>
          <label
            htmlFor={`${provider.id}-base-url`}
            className="mb-1.5 block text-[12px] font-medium text-text-secondary"
          >
            API 代理地址
          </label>
          <input
            id={`${provider.id}-base-url`}
            type="text"
            value={state.baseUrl}
            onChange={(event) =>
              onChange({ ...state, baseUrl: event.target.value })
            }
            placeholder={provider.baseUrlPlaceholder}
            className="w-full rounded-lg border border-border bg-surface-0 px-3 py-2 text-[12px] text-text-primary placeholder:text-text-muted/50 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </div>
      </div>

      <div>
        <div className="mb-3 text-[13px] font-semibold text-text-primary">
          模型列表
        </div>
        <div className="space-y-2">
          {provider.models.map((model) => {
            const modelState = state.models.find(
              (item) => item.id === model.id,
            );
            const enabled = modelState?.enabled ?? false;
            return (
              <div
                key={model.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-0 px-3 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium text-text-primary">
                    {model.name}
                  </div>
                  <div className="mt-1 text-[10px] text-text-muted">
                    {model.description}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...state,
                      models: state.models.map((item) =>
                        item.id === model.id
                          ? { ...item, enabled: !item.enabled }
                          : item,
                      ),
                    })
                  }
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                    enabled ? "bg-emerald-500" : "bg-surface-3",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                      enabled ? "translate-x-[18px]" : "translate-x-[3px]",
                    )}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
