import { ModelLogo, ProviderLogo } from "@/components/provider-logo";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Cpu, Search, Settings } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  getApiInternalDesktopDefaultModel,
  getApiV1Models,
  putApiInternalDesktopDefaultModel,
} from "../../lib/api/sdk.gen";

/**
 * Inline Model Selector for Hero status bar
 *
 * A compact dropdown that shows the current model and allows switching.
 * Reuses the same data flow as the Models page.
 */

interface Model {
  id: string;
  name: string;
  provider: string;
  isDefault?: boolean;
  description?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  nexu: "Nexu Official",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI",
};

function getGroupKey(m: Model): string {
  return m.id.startsWith("link/") ? "nexu" : m.provider;
}

function formatModelName(modelId: string | null | undefined): string {
  if (!modelId) return "Claude Sonnet 4.5";
  const withoutProvider = modelId.includes("/")
    ? modelId.split("/").slice(1).join("/")
    : modelId;
  return withoutProvider
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function InlineModelSelector() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  // Fetch current model
  const { data: defaultModelData } = useQuery({
    queryKey: ["desktop-default-model"],
    queryFn: async () => {
      const { data } = await getApiInternalDesktopDefaultModel();
      return data as { modelId: string | null } | undefined;
    },
  });

  // Fetch available models
  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const { data } = await getApiV1Models();
      return data;
    },
  });

  const models = (modelsData?.models ?? []) as Model[];
  const currentModelId = defaultModelData?.modelId ?? "";
  const currentModel = models.find((m: Model) => m.id === currentModelId);
  const currentGroupKey = currentModel ? getGroupKey(currentModel) : "";

  // Model name for display
  const modelName = currentModelId
    ? (currentModel?.name ?? formatModelName(currentModelId))
    : formatModelName(null);

  // Update model mutation
  const updateModel = useMutation({
    mutationFn: async (modelId: string) => {
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
      // Config push triggers SIGUSR1 restart; immediately refetch live status
      // so the UI reflects the restart sooner.
      queryClient.invalidateQueries({ queryKey: ["channels-live-status"] });
    },
  });

  // Group models by provider
  const modelsByProvider = useMemo(() => {
    const map = new Map<string, Model[]>();
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

  // Expand current model's provider only when dropdown opens (not on refetch)
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
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
    prevOpenRef.current = open;
  }, [open, currentModel, modelsByProvider]);

  const query = search.toLowerCase().trim();
  const filteredProviders = modelsByProvider
    .map((p) => ({
      ...p,
      models: p.models.filter(
        (m: Model) =>
          !query ||
          m.name.toLowerCase().includes(query) ||
          p.name.toLowerCase().includes(query),
      ),
    }))
    .filter((p) => p.models.length > 0);

  // Empty state - no models available
  if (models.length === 0) {
    return (
      <button
        type="button"
        onClick={() => navigate("/workspace/models?tab=providers")}
        className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary transition-colors"
      >
        <Cpu size={10} />
        <span>{t("models.noModelConfigured")}</span>
        <ChevronDown size={9} />
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      {/* Trigger - pill button with border */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-surface-0 hover:border-border-hover hover:bg-surface-1 transition-all text-[12px] text-text-primary"
      >
        <span className="w-4 h-4 shrink-0 flex items-center justify-center">
          {currentGroupKey ? (
            <ModelLogo model={modelName} provider={currentGroupKey} size={14} />
          ) : (
            <Cpu size={13} className="text-text-muted" />
          )}
        </span>
        <span className="font-medium">{modelName}</span>
        <ChevronDown
          size={10}
          className={cn(
            "text-text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-2 left-0 w-[280px] rounded-xl border border-border bg-surface-1 shadow-xl">
          {/* Search */}
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center gap-2 rounded-lg bg-surface-0 border border-border px-3 py-2">
              <Search size={12} className="text-text-muted shrink-0" />
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
                className="flex-1 bg-transparent text-[12px] text-text-primary placeholder:text-text-muted/50 outline-none"
                // biome-ignore lint/a11y/noAutofocus: Intentional for dropdown search UX
                autoFocus
              />
            </div>
          </div>

          {/* Provider groups */}
          <div className="relative">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-3 z-10 bg-gradient-to-b from-surface-1 to-transparent" />
            <div
              className="max-h-[280px] overflow-y-auto py-1"
              style={{
                overscrollBehavior: "contain",
                WebkitOverflowScrolling: "touch",
              }}
            >
              {filteredProviders.length === 0 ? (
                <div className="px-4 py-6 text-center text-[12px] text-text-muted">
                  {t("models.byok.none")}
                </div>
              ) : (
                filteredProviders.map((provider) => {
                  const isExpanded =
                    expandedProviders.has(provider.id) || !!query;
                  return (
                    <div key={provider.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (query) return;
                          setExpandedProviders((prev) => {
                            const next = new Set(prev);
                            if (next.has(provider.id)) next.delete(provider.id);
                            else next.add(provider.id);
                            return next;
                          });
                        }}
                        className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-surface-2/50 transition-colors"
                      >
                        <ChevronDown
                          size={10}
                          className={cn(
                            "text-text-muted/50 transition-transform",
                            !isExpanded && "-rotate-90",
                          )}
                        />
                        <span className="w-[14px] h-[14px] shrink-0 flex items-center justify-center">
                          <ProviderLogo provider={provider.id} size={13} />
                        </span>
                        <span className="text-[11px] font-medium text-text-secondary">
                          {provider.name}
                        </span>
                        <span className="text-[10px] text-text-muted/40 ml-auto tabular-nums">
                          {provider.models.length}
                        </span>
                      </button>
                      {isExpanded &&
                        provider.models.map((model: Model) => (
                          <button
                            key={model.id}
                            type="button"
                            onClick={() => {
                              updateModel.mutate(model.id);
                              setOpen(false);
                              setSearch("");
                            }}
                            className={cn(
                              "w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-left transition-colors hover:bg-surface-2",
                              model.id === currentModelId && "bg-accent/5",
                            )}
                          >
                            {model.id === currentModelId ? (
                              <Check
                                size={12}
                                className="text-accent shrink-0"
                              />
                            ) : (
                              <span className="w-[12px] shrink-0" />
                            )}
                            <span className="w-[14px] h-[14px] shrink-0 flex items-center justify-center">
                              <ModelLogo
                                model={model.name}
                                provider={provider.id}
                                size={13}
                              />
                            </span>
                            <span className="text-[12px] font-medium text-text-primary truncate flex-1">
                              {model.name}
                            </span>
                          </button>
                        ))}
                    </div>
                  );
                })
              )}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3 z-10 bg-gradient-to-t from-surface-1 to-transparent" />
          </div>

          {/* Footer - Settings link */}
          <div className="px-3 py-2 border-t border-border">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/workspace/models?tab=providers");
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] text-text-secondary hover:bg-surface-2 transition-colors"
            >
              <Settings size={11} />
              <span>{t("home.configureProviders")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
