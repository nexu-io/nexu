import { ProviderLogo } from "@/components/provider-logo";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { getApiV1Models } from "../../lib/api/sdk.gen";

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

// ── Static provider data ───────────────────────────────────────

function buildProviders(
  apiModels: Array<{
    id: string;
    name: string;
    provider: string;
    isDefault?: boolean;
    description?: string;
  }>,
): ProviderConfig[] {
  const providerMeta: Record<
    string,
    { name: string; description: string; apiDocsUrl?: string }
  > = {
    nexu: {
      name: "Nexu Official",
      description:
        "Platform-managed models. No API key needed — included with your account.",
    },
    anthropic: {
      name: "Anthropic",
      description: "Claude family of AI models by Anthropic.",
      apiDocsUrl: "https://docs.anthropic.com",
    },
    openai: {
      name: "OpenAI",
      description: "GPT family of AI models by OpenAI.",
      apiDocsUrl: "https://platform.openai.com/docs",
    },
    google: {
      name: "Google",
      description: "Gemini family of AI models by Google.",
      apiDocsUrl: "https://ai.google.dev/docs",
    },
  };

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
    const meta = providerMeta[providerId] ?? {
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

// ── Component ──────────────────────────────────────────────────

export function ModelsPage() {
  const [search, setSearch] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(
    null,
  );
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    new Set(),
  );

  const { data: modelsData, isLoading } = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      const { data } = await getApiV1Models();
      return data;
    },
  });

  const providers = useMemo(
    () => buildProviders(modelsData?.models ?? []),
    [modelsData],
  );

  // Auto-select first provider
  const activeProvider =
    providers.find((p) => p.id === selectedProviderId) ?? providers[0] ?? null;

  const query = search.toLowerCase().trim();
  const filteredProviders = useMemo(() => {
    if (!query) return providers;
    return providers
      .map((p) => ({
        ...p,
        models: p.models.filter(
          (m) =>
            m.name.toLowerCase().includes(query) ||
            m.id.toLowerCase().includes(query) ||
            p.name.toLowerCase().includes(query),
        ),
      }))
      .filter((p) => p.models.length > 0);
  }, [providers, query]);

  const toggleProvider = (id: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[13px] text-text-muted">Loading models...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left sidebar — provider list */}
      <div className="w-[240px] shrink-0 border-r border-border bg-surface-1 flex flex-col">
        <div className="px-4 py-4 border-b border-border">
          <h2 className="text-[14px] font-semibold text-text-primary mb-3">
            AI Model Providers
          </h2>
          <div className="flex items-center gap-2 rounded-lg bg-surface-0 border border-border px-2.5 py-2">
            <Search size={13} className="text-text-muted shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="flex-1 bg-transparent text-[12px] text-text-primary placeholder:text-text-muted/50 outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {filteredProviders.map((provider) => {
            const isActive = activeProvider?.id === provider.id;
            const enabledCount = provider.models.filter(
              (m) => m.enabled,
            ).length;
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() => setSelectedProviderId(provider.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors",
                  isActive
                    ? "bg-accent/8 border-r-2 border-accent"
                    : "hover:bg-surface-2",
                )}
              >
                <span className="w-5 h-5 shrink-0 flex items-center justify-center">
                  <ProviderLogo provider={provider.id} size={16} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-text-primary truncate">
                    {provider.name}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {enabledCount} model{enabledCount !== 1 ? "s" : ""}
                  </div>
                </div>
                <div
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    enabledCount > 0 ? "bg-emerald-500" : "bg-text-muted/30",
                  )}
                />
              </button>
            );
          })}

          {filteredProviders.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-text-muted">
              No matching providers
            </div>
          )}
        </div>
      </div>

      {/* Right panel — provider detail */}
      <div className="flex-1 overflow-y-auto">
        {activeProvider ? (
          <ProviderDetail provider={activeProvider} />
        ) : (
          <div className="flex items-center justify-center h-full text-[13px] text-text-muted">
            Select a provider
          </div>
        )}
      </div>
    </div>
  );
}

// ── Provider detail panel ──────────────────────────────────────

function ProviderDetail({ provider }: { provider: ProviderConfig }) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [expandedModels, setExpandedModels] = useState(true);

  const enabledModels = provider.models.filter((m) => m.enabled);
  const disabledModels = provider.models.filter((m) => !m.enabled);

  return (
    <div className="max-w-[640px] mx-auto px-6 py-6">
      {/* Provider header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center shrink-0">
          <ProviderLogo provider={provider.id} size={22} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1">
            <h3 className="text-[16px] font-semibold text-text-primary">
              {provider.name}
            </h3>
            {provider.managed && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-[10px] font-medium">
                Platform managed
              </span>
            )}
          </div>
          <p className="text-[13px] text-text-muted leading-relaxed">
            {provider.description}
          </p>
          {provider.apiDocsUrl && (
            <a
              href={provider.apiDocsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1.5 text-[12px] text-accent hover:underline"
            >
              API Docs <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>

      {/* API Key section (hidden for managed providers) */}
      {!provider.managed && (
        <div className="mb-6 rounded-xl border border-border bg-surface-1 p-4">
          <div className="text-[12px] font-medium text-text-secondary mb-2">
            API Key
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 rounded-lg border border-border bg-surface-0 px-3 py-2">
              <input
                type={showApiKey ? "text" : "password"}
                placeholder={`Enter ${provider.name} API key...`}
                className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-muted/50 outline-none"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="text-text-muted hover:text-text-primary transition-colors"
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-text-muted">
            Your API key is encrypted and stored securely. It is never shared.
          </p>
        </div>
      )}

      {/* Model list */}
      <div className="rounded-xl border border-border bg-surface-1">
        <button
          type="button"
          onClick={() => setExpandedModels(!expandedModels)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-text-primary">
              Models
            </span>
            <span className="text-[11px] text-text-muted px-1.5 py-0.5 rounded-md bg-surface-3">
              {enabledModels.length} enabled
            </span>
          </div>
          <ChevronDown
            size={14}
            className={cn(
              "text-text-muted transition-transform",
              expandedModels ? "" : "-rotate-90",
            )}
          />
        </button>

        {expandedModels && (
          <div className="border-t border-border">
            {enabledModels.length > 0 && (
              <div>
                {enabledModels.map((model, i) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    providerId={provider.id}
                    isLast={
                      i === enabledModels.length - 1 &&
                      disabledModels.length === 0
                    }
                  />
                ))}
              </div>
            )}

            {disabledModels.length > 0 && (
              <div>
                <div className="px-4 py-2 text-[10px] font-medium text-text-muted uppercase tracking-wider bg-surface-2/50">
                  Disabled
                </div>
                {disabledModels.map((model, i) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    providerId={provider.id}
                    isLast={i === disabledModels.length - 1}
                  />
                ))}
              </div>
            )}

            {enabledModels.length === 0 && disabledModels.length === 0 && (
              <div className="px-4 py-6 text-center text-[12px] text-text-muted">
                No models available
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Model row ──────────────────────────────────────────────────

function ModelRow({
  model,
  providerId,
  isLast,
}: {
  model: ProviderModel;
  providerId: string;
  isLast: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3",
        !isLast && "border-b border-border/50",
      )}
    >
      <span className="w-5 h-5 shrink-0 flex items-center justify-center">
        <ProviderLogo provider={providerId} size={14} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text-primary truncate">
          {model.name}
        </div>
        {model.description && (
          <div className="text-[11px] text-text-muted truncate">
            {model.description}
          </div>
        )}
      </div>
      <div className="text-[11px] text-text-muted/60 shrink-0 font-mono">
        {model.id}
      </div>
      <div
        className={cn(
          "w-2 h-2 rounded-full shrink-0",
          model.enabled ? "bg-emerald-500" : "bg-text-muted/30",
        )}
      />
    </div>
  );
}
