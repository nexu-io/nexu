import { ModelLogo, ProviderLogo } from "@/components/provider-logo";
import { track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Cpu, Search, Settings } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ModelPickerItem {
  id: string;
  name: string;
  provider: string;
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
  custom: "Custom",
};

function getGroupKey(model: ModelPickerItem): string {
  if (model.id.startsWith("link/")) {
    return "nexu";
  }

  if (model.provider.startsWith("custom_")) {
    return "custom";
  }

  return model.provider;
}

function getModelLabel(modelId: string): string {
  return modelId.includes("/")
    ? modelId.split("/").slice(1).join("/")
    : modelId;
}

type ModelPickerDropdownProps = {
  models: ModelPickerItem[];
  currentModelId: string;
  emptyLabel: string;
  onSelectModel: (modelId: string) => void;
  onOpenSettings?: () => void;
  className?: string;
  triggerClassName?: string;
  dropdownClassName?: string;
  compact?: boolean;
  dropdownAlign?: "start" | "end" | "stretch";
};

export function ModelPickerDropdown({
  models,
  currentModelId,
  emptyLabel,
  onSelectModel,
  onOpenSettings,
  className,
  triggerClassName,
  dropdownClassName,
  compact = false,
  dropdownAlign = compact ? "start" : "stretch",
}: ModelPickerDropdownProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const currentItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        closePicker();
      }
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const currentModel = models.find((model) => model.id === currentModelId);
  const currentGroupKey = currentModel
    ? getGroupKey(currentModel)
    : currentModelId.startsWith("link/")
      ? "nexu"
      : currentModelId.startsWith("custom_")
        ? "custom"
        : (currentModelId.split("/")[0] ?? "");
  const currentModelLabel = currentModelId
    ? (currentModel?.name ?? getModelLabel(currentModelId))
    : emptyLabel;

  const modelsByProvider = useMemo(() => {
    const grouped = new Map<string, ModelPickerItem[]>();
    for (const model of models) {
      const groupKey = getGroupKey(model);
      const list = grouped.get(groupKey) ?? [];
      list.push(model);
      grouped.set(groupKey, list);
    }

    const entries = Array.from(grouped.entries());
    entries.sort((a, b) => {
      if (a[0] === "nexu") return -1;
      if (b[0] === "nexu") return 1;
      if (a[0] === "custom") return 1;
      if (b[0] === "custom") return -1;
      return a[0].localeCompare(b[0]);
    });

    return entries.map(([providerId, providerModels]) => ({
      id: providerId,
      name: PROVIDER_LABELS[providerId] ?? providerId,
      models: providerModels,
    }));
  }, [models]);

  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    () => new Set(currentGroupKey ? [currentGroupKey] : []),
  );

  const resolveOpenGroups = (): Set<string> =>
    new Set(
      currentGroupKey
        ? [currentGroupKey]
        : modelsByProvider.length > 0 && modelsByProvider[0]
          ? [modelsByProvider[0].id]
          : [],
    );

  const closePicker = () => {
    setOpen(false);
    setSearch("");
  };

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    currentItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const query = search.toLowerCase().trim();
  const filteredProviders = modelsByProvider
    .map((provider) => ({
      ...provider,
      models: provider.models.filter(
        (model) =>
          !query ||
          model.name.toLowerCase().includes(query) ||
          provider.name.toLowerCase().includes(query),
      ),
    }))
    .filter((provider) => provider.models.length > 0);

  if (models.length === 0) {
    return compact ? (
      <button
        type="button"
        onClick={onOpenSettings}
        className={cn(
          "flex items-center gap-1 text-[11px] text-text-muted hover:text-text-secondary transition-colors",
          className,
        )}
      >
        <Cpu size={10} />
        <span>{emptyLabel}</span>
        <ChevronDown size={9} />
      </button>
    ) : (
      <div
        className={cn(
          "rounded-xl border border-border bg-surface-0 px-4 py-4 mb-5",
          className,
        )}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface-2 shrink-0">
            <Cpu size={16} className="text-text-muted" />
          </div>
          <div>
            <div className="text-[13px] font-medium text-text-primary">
              {emptyLabel}
            </div>
            <div className="text-[11px] text-text-muted">
              {t("models.configureProviderHint")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const dropdownPositionClass =
    dropdownAlign === "end"
      ? "right-0"
      : dropdownAlign === "stretch"
        ? "left-0 right-0"
        : "left-0";

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (open) {
            closePicker();
            return;
          }

          track("workspace_change_model_click");
          setExpandedProviders(resolveOpenGroups());
          setOpen(true);
        }}
        className={cn(
          compact
            ? "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-surface-0 hover:border-border-hover hover:bg-surface-1 transition-all text-[12px] text-text-primary"
            : "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-surface-0 hover:bg-surface-2 hover:border-border-hover transition-all text-[12px] font-medium text-text-primary",
          triggerClassName,
        )}
      >
        <span
          className={cn(
            compact ? "w-4 h-4" : "w-4 h-4",
            "shrink-0 flex items-center justify-center",
          )}
        >
          {currentGroupKey ? (
            <ModelLogo
              model={currentModelLabel}
              provider={currentGroupKey}
              size={14}
            />
          ) : (
            <Cpu size={13} className="text-text-muted" />
          )}
        </span>
        <span className={cn(compact ? "font-medium" : undefined)}>
          {currentModelLabel}
        </span>
        <ChevronDown
          size={compact ? 10 : 13}
          className={cn(
            "text-text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          className={cn(
            compact
              ? `absolute z-50 mt-2 ${dropdownPositionClass} min-w-[340px] rounded-xl border border-border bg-surface-1 shadow-xl`
              : `absolute top-full ${dropdownPositionClass} z-20 mt-1 rounded-xl border border-border bg-surface-0 shadow-lg overflow-hidden`,
            dropdownClassName,
          )}
        >
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center gap-2 rounded-lg bg-surface-0 border border-border px-3 py-2">
              <Search
                size={compact ? 12 : 14}
                className="text-text-muted shrink-0"
              />
              <input
                type="text"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  if (event.target.value.trim()) {
                    setExpandedProviders(
                      new Set(modelsByProvider.map((provider) => provider.id)),
                    );
                  }
                }}
                placeholder={t("models.searchModels")}
                className={cn(
                  "flex-1 bg-transparent text-text-primary placeholder:text-text-muted/50 outline-none",
                  compact ? "text-[12px]" : "text-[13px]",
                )}
                // biome-ignore lint/a11y/noAutofocus: Intentional for dropdown search UX
                autoFocus
              />
            </div>
          </div>

          <div className={compact ? "relative" : undefined}>
            {compact && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-3 z-10 bg-gradient-to-b from-surface-1 to-transparent" />
            )}
            <div
              className={cn(
                compact
                  ? "max-h-[280px] overflow-y-auto py-1"
                  : "max-h-[320px] overflow-y-auto",
              )}
              style={
                compact
                  ? {
                      overscrollBehavior: "contain",
                      WebkitOverflowScrolling: "touch",
                    }
                  : undefined
              }
            >
              {filteredProviders.length === 0 ? (
                <div
                  className={cn(
                    compact ? "px-4 py-6" : "px-4 py-8",
                    "text-center text-[12px] text-text-muted",
                  )}
                >
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
                          setExpandedProviders((previous) => {
                            const next = new Set(previous);
                            if (next.has(provider.id)) next.delete(provider.id);
                            else next.add(provider.id);
                            return next;
                          });
                        }}
                        className={cn(
                          compact
                            ? "w-full px-3 py-1.5 flex items-center gap-2 hover:bg-surface-2/50 transition-colors"
                            : "w-full px-3 pt-2.5 pb-1 text-left hover:bg-surface-1/50 transition-colors flex items-center gap-2",
                        )}
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
                        <span
                          className={cn(
                            compact
                              ? "text-[11px]"
                              : "text-[10px] uppercase tracking-wider",
                            "font-medium text-text-secondary",
                          )}
                        >
                          {provider.name}
                        </span>
                        <span className="text-[10px] text-text-muted/40 ml-auto tabular-nums">
                          {provider.models.length}
                        </span>
                      </button>
                      {isExpanded &&
                        provider.models.map((model) => {
                          const isSelected = model.id === currentModelId;
                          return (
                            <button
                              key={model.id}
                              ref={isSelected ? currentItemRef : null}
                              type="button"
                              onClick={() => {
                                onSelectModel(model.id);
                                closePicker();
                              }}
                              className={cn(
                                compact
                                  ? "w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-left transition-colors hover:bg-surface-2"
                                  : "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                                isSelected
                                  ? "bg-accent/5"
                                  : compact
                                    ? undefined
                                    : "hover:bg-surface-2",
                              )}
                            >
                              {compact ? (
                                isSelected ? (
                                  <Check
                                    size={12}
                                    className="text-accent shrink-0"
                                  />
                                ) : (
                                  <span className="w-[12px] shrink-0" />
                                )
                              ) : (
                                <span className="w-5 h-5 shrink-0 flex items-center justify-center">
                                  {isSelected ? (
                                    <Check
                                      size={14}
                                      className="text-accent shrink-0"
                                    />
                                  ) : null}
                                </span>
                              )}
                              <span className="w-[14px] h-[14px] shrink-0 flex items-center justify-center">
                                <ModelLogo
                                  model={model.name}
                                  provider={provider.id}
                                  size={13}
                                />
                              </span>
                              <div className="flex-1 min-w-0">
                                <div
                                  className={cn(
                                    compact
                                      ? "text-[12px]"
                                      : "text-[12px] truncate",
                                    isSelected
                                      ? "font-semibold text-accent"
                                      : "font-medium text-text-primary",
                                  )}
                                >
                                  {model.name}
                                </div>
                                {!compact && (
                                  <div className="text-[10px] text-text-tertiary">
                                    {provider.name}
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                    </div>
                  );
                })
              )}
            </div>
            {compact && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-3 z-10 bg-gradient-to-t from-surface-1 to-transparent" />
            )}
          </div>

          {onOpenSettings && (
            <div className="px-3 py-2 border-t border-border">
              <button
                type="button"
                onClick={() => {
                  closePicker();
                  track("workspace_configure_model_provider_click");
                  onOpenSettings();
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11px] text-text-secondary hover:bg-surface-2 transition-colors"
              >
                <Settings size={11} />
                <span>{t("home.configureProviders")}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
