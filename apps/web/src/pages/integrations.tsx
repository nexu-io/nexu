import { ToolkitIcon } from "@/components/toolkit-icon";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Puzzle,
  Search,
  Shield,
  Trash2,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import "@/lib/api";
import {
  deleteApiV1IntegrationsByIntegrationId,
  getApiV1Integrations,
  postApiV1IntegrationsByIntegrationIdRefresh,
  postApiV1IntegrationsConnect,
} from "../../lib/api/sdk.gen";

type Integration = NonNullable<
  Awaited<ReturnType<typeof getApiV1Integrations>>["data"]
>["integrations"][number];

type StatusFilter = "all" | "connected" | "available";

function useStatusBadgeConfig() {
  const { t } = useTranslation();
  return useMemo(
    () =>
      ({
        active: {
          label: t("integrations.statusConnected"),
          dot: "bg-[var(--color-success)]",
          bg: "bg-[var(--color-success-muted)]",
          text: "text-[var(--color-success)]",
        },
        initiated: {
          label: t("integrations.statusConnecting"),
          dot: "bg-amber-500",
          bg: "bg-amber-500/10",
          text: "text-amber-600",
        },
        pending: {
          label: t("integrations.statusAvailable"),
          dot: "bg-text-muted/30",
          bg: "bg-surface-3",
          text: "text-text-muted",
        },
        failed: {
          label: t("integrations.statusFailed"),
          dot: "bg-red-500",
          bg: "bg-red-500/10",
          text: "text-red-600",
        },
        expired: {
          label: t("integrations.statusExpired"),
          dot: "bg-red-500",
          bg: "bg-red-500/10",
          text: "text-red-600",
        },
        disconnected: {
          label: t("integrations.statusDisconnected"),
          dot: "bg-text-muted/30",
          bg: "bg-surface-3",
          text: "text-text-muted",
        },
      }) as Record<
        string,
        { label: string; dot: string; bg: string; text: string }
      >,
    [t],
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const statusBadge = useStatusBadgeConfig();
  const fallback = {
    label: t("integrations.statusUnknown"),
    dot: "bg-text-muted/30",
    bg: "bg-surface-3",
    text: "text-text-muted",
  };
  const cfg = statusBadge[status] ?? fallback;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium",
        cfg.bg,
        cfg.text,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ToolkitIcon imported from @/components/toolkit-icon

// ─── API Key Form ───────────────────────────────────────────

function ApiKeyForm({
  integration,
  onSubmit,
  isSubmitting,
}: {
  integration: Integration;
  onSubmit: (credentials: Record<string, string>) => void;
  isSubmitting: boolean;
}) {
  const { t } = useTranslation();
  const fields = integration.toolkit.authFields ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ""])),
  );
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(values);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {fields.map((field) => (
        <div key={field.key}>
          <label className="block text-[12px] font-medium text-text-secondary mb-1">
            {field.label}
            <div className="relative mt-1">
              <input
                type={
                  field.type === "secret" && !revealed[field.key]
                    ? "password"
                    : "text"
                }
                value={values[field.key] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [field.key]: e.target.value,
                  }))
                }
                placeholder={field.placeholder}
                className="w-full px-3 py-2 pr-9 rounded-lg border border-border bg-surface-1 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
              />
              {field.type === "secret" && (
                <button
                  type="button"
                  onClick={() =>
                    setRevealed((prev) => ({
                      ...prev,
                      [field.key]: !prev[field.key],
                    }))
                  }
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary"
                >
                  {revealed[field.key] ? (
                    <EyeOff size={14} />
                  ) : (
                    <Eye size={14} />
                  )}
                </button>
              )}
            </div>
          </label>
          {integration.credentialHints?.[field.key] && (
            <div className="mt-1 text-[11px] text-text-muted">
              Current: {integration.credentialHints[field.key]}
            </div>
          )}
        </div>
      ))}
      <button
        type="submit"
        disabled={isSubmitting || fields.some((f) => !values[f.key]?.trim())}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Key size={14} />
        )}
        {integration.status === "active"
          ? t("integrations.updateCredentials")
          : t("integrations.saveConnect")}
      </button>
    </form>
  );
}

// ─── Disconnect Dialog ──────────────────────────────────────

function DisconnectDialog({
  name,
  onConfirm,
  onCancel,
  isPending,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/30"
        onClick={onCancel}
      />
      <div className="relative bg-surface-1 border border-border rounded-xl shadow-xl p-5 w-[380px] max-w-[90vw]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
            <Unplug size={18} className="text-red-500" />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-text-primary">
              {t("integrations.disconnectTitle", { name })}
            </h3>
            <p className="text-[12px] text-text-muted">
              {t("integrations.disconnectDesc")}
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-surface-3 transition-colors"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            {t("integrations.disconnect")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Integration Card ───────────────────────────────────────

function IntegrationCard({
  integration,
  onConnect,
  onDisconnect,
  isConnecting,
  expandedSlug,
  onToggleExpand,
}: {
  integration: Integration;
  onConnect: (slug: string, credentials?: Record<string, string>) => void;
  onDisconnect: () => void;
  isConnecting: boolean;
  expandedSlug: string | null;
  onToggleExpand: (slug: string) => void;
}) {
  const { t } = useTranslation();
  const { toolkit, status } = integration;
  const isGlobal = toolkit.authScheme === "api_key_global";
  const isApiKey = toolkit.authScheme === "api_key_user";
  const isActive = status === "active";
  const isExpanded = expandedSlug === toolkit.slug;

  return (
    <div
      className={cn(
        "rounded-xl border bg-surface-1 p-4 transition-all",
        isActive
          ? "border-[color-mix(in_srgb,var(--color-success)_25%,transparent)]"
          : "border-border hover:border-accent/25 hover:shadow-md hover:shadow-accent/5",
      )}
    >
      <div className="flex items-start gap-3">
        <ToolkitIcon
          iconUrl={toolkit.iconUrl}
          fallbackIconUrl={toolkit.fallbackIconUrl}
          name={toolkit.displayName}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[13px] font-semibold text-text-primary truncate">
              {toolkit.displayName}
            </span>
            {isGlobal && (
              <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium shrink-0">
                <Shield size={9} /> {t("integrations.provided")}
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-muted leading-relaxed line-clamp-2">
            {toolkit.description}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Action area */}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted font-medium capitalize">
          {toolkit.category}
        </span>
        <div className="flex items-center gap-2">
          {isActive && !isGlobal && (
            <button
              type="button"
              onClick={onDisconnect}
              className="text-[11px] text-text-muted hover:text-red-500 transition-colors"
            >
              {t("integrations.disconnect")}
            </button>
          )}
          {!isGlobal && !isActive && !isApiKey && (
            <button
              type="button"
              onClick={() => onConnect(toolkit.slug)}
              disabled={isConnecting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium text-white bg-accent hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {isConnecting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <ExternalLink size={12} />
              )}
              {t("common.connect")}
            </button>
          )}
          {isApiKey && (
            <button
              type="button"
              onClick={() => onToggleExpand(toolkit.slug)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors",
                isExpanded
                  ? "text-text-secondary bg-surface-3"
                  : isActive
                    ? "text-accent bg-accent/10 hover:bg-accent/15"
                    : "text-white bg-accent hover:bg-accent-hover",
              )}
            >
              <Key size={12} />
              {isActive
                ? t("integrations.update")
                : t("integrations.configure")}
            </button>
          )}
        </div>
      </div>

      {/* Credential hints for connected api_key_user */}
      {isActive &&
        isApiKey &&
        !isExpanded &&
        integration.credentialHints &&
        Object.keys(integration.credentialHints).length > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex flex-wrap gap-2">
              {Object.entries(integration.credentialHints).map(
                ([key, hint]) => (
                  <span
                    key={key}
                    className="text-[11px] text-text-muted bg-surface-2 px-2 py-1 rounded font-mono"
                  >
                    {key}: {hint}
                  </span>
                ),
              )}
            </div>
          </div>
        )}

      {/* Expanded API key form */}
      {isApiKey && isExpanded && (
        <div className="mt-3 pt-3 border-t border-border">
          <ApiKeyForm
            integration={integration}
            onSubmit={(creds) => onConnect(toolkit.slug, creds)}
            isSubmitting={isConnecting}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export function IntegrationsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<Integration | null>(
    null,
  );
  const pollingRef = useRef<{
    integrationId: string;
    state: string;
    timer: ReturnType<typeof setInterval>;
  } | null>(null);
  const oauthTabRef = useRef<Window | null>(null);

  // Handle OAuth callback from search params
  const callbackToolkit = searchParams.get("toolkit");
  const callbackState = searchParams.get("state");
  const callbackReturnTo = searchParams.get("returnTo");

  const { data, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const { data } = await getApiV1Integrations();
      return data;
    },
    refetchInterval: 10000,
  });

  const integrations = data?.integrations ?? [];

  // OAuth callback: poll for completion
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run when integrations list length changes
  useEffect(() => {
    if (!callbackToolkit || !callbackState) return;

    const match = integrations.find(
      (i) => i.toolkit.slug === callbackToolkit && i.id,
    );
    if (!match?.id) return;

    // Clear callback params
    const next = new URLSearchParams(searchParams);
    next.delete("toolkit");
    next.delete("state");
    next.delete("source");
    next.delete("returnTo");
    setSearchParams(next, { replace: true });

    // Start polling (pass returnTo so we navigate back after success)
    startPolling(match.id, callbackState, callbackReturnTo);
  }, [callbackToolkit, callbackState, integrations.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPolling = useCallback(
    (integrationId: string, state: string, returnTo?: string | null) => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current.timer);
      }
      let attempts = 0;
      const timer = setInterval(async () => {
        attempts++;
        try {
          const { data: refreshed } =
            await postApiV1IntegrationsByIntegrationIdRefresh({
              path: { integrationId },
              body: { state },
            });
          if (refreshed?.status === "active") {
            clearInterval(timer);
            pollingRef.current = null;
            toast.success(
              `${refreshed.toolkit.displayName} connected successfully`,
            );
            queryClient.invalidateQueries({ queryKey: ["integrations"] });
            if (returnTo) {
              navigate(returnTo, { replace: true });
            }
          } else if (attempts >= 20) {
            clearInterval(timer);
            pollingRef.current = null;
            toast.error("Connection timed out. Please try again.");
            queryClient.invalidateQueries({ queryKey: ["integrations"] });
          }
        } catch {
          clearInterval(timer);
          pollingRef.current = null;
          toast.error("Failed to verify connection status");
          queryClient.invalidateQueries({ queryKey: ["integrations"] });
        }
      }, 3000);
      pollingRef.current = { integrationId, state, timer };
    },
    [queryClient, navigate],
  );

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current.timer);
    };
  }, []);

  const connectMutation = useMutation({
    mutationFn: async ({
      slug,
      credentials,
    }: {
      slug: string;
      credentials?: Record<string, string>;
    }) => {
      const { data } = await postApiV1IntegrationsConnect({
        body: { toolkitSlug: slug, credentials, source: "page" },
      });
      return data;
    },
    onSuccess: (result) => {
      if (!result) return;
      queryClient.invalidateQueries({ queryKey: ["integrations"] });

      if (result.connectUrl) {
        // OAuth2 flow — store state + toolkit display info for callback page
        if (result.integration.id && result.state) {
          localStorage.setItem(
            `nexu-oauth-pending-${result.integration.id}`,
            JSON.stringify({
              state: result.state,
              toolkitSlug: result.integration.toolkit.slug,
              toolkitDisplayName: result.integration.toolkit.displayName,
              toolkitIconUrl: result.integration.toolkit.iconUrl,
              toolkitFallbackIconUrl:
                result.integration.toolkit.fallbackIconUrl,
            }),
          );
        }
        // Use pre-opened tab to avoid popup blocking
        if (oauthTabRef.current) {
          oauthTabRef.current.location.href = result.connectUrl;
          oauthTabRef.current = null;
        } else {
          window.open(result.connectUrl, "_blank", "noopener");
        }
        toast.info("Complete the authorization in the new tab");
        if (result.integration.id && result.state) {
          startPolling(result.integration.id, result.state);
        }
      } else {
        oauthTabRef.current?.close();
        oauthTabRef.current = null;
        if (result.integration.status === "active") {
          // API key saved
          toast.success(
            `${result.integration.toolkit.displayName} connected successfully`,
          );
          setExpandedSlug(null);
        }
      }
    },
    onError: () => {
      oauthTabRef.current?.close();
      oauthTabRef.current = null;
      toast.error("Failed to connect. Please try again.");
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async (integrationId: string) => {
      await deleteApiV1IntegrationsByIntegrationId({
        path: { integrationId },
      });
    },
    onSuccess: () => {
      toast.success(
        `${disconnectTarget?.toolkit.displayName ?? "Integration"} disconnected`,
      );
      setDisconnectTarget(null);
      queryClient.invalidateQueries({ queryKey: ["integrations"] });
    },
    onError: () => {
      toast.error("Failed to disconnect. Please try again.");
    },
  });

  const filtered = useMemo(() => {
    let list = integrations;
    if (statusFilter === "connected") {
      list = list.filter((i) => i.status === "active");
    } else if (statusFilter === "available") {
      list = list.filter((i) => i.status !== "active");
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (i) =>
          i.toolkit.displayName.toLowerCase().includes(q) ||
          i.toolkit.description.toLowerCase().includes(q) ||
          i.toolkit.slug.toLowerCase().includes(q),
      );
    }
    return list;
  }, [integrations, statusFilter, query]);

  const connectedCount = integrations.filter(
    (i) => i.status === "active",
  ).length;
  const availableCount = integrations.filter(
    (i) => i.status !== "active",
  ).length;

  const filterTabs: { id: StatusFilter; label: string; count: number }[] = [
    { id: "all", label: t("integrations.all"), count: integrations.length },
    {
      id: "connected",
      label: t("integrations.connectedFilter"),
      count: connectedCount,
    },
    {
      id: "available",
      label: t("integrations.available"),
      count: availableCount,
    },
  ];

  return (
    <div className="min-h-full bg-surface-0">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b border-border bg-surface-0/85 backdrop-blur-md">
        <div className="h-14 max-w-4xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Puzzle size={16} className="text-accent" />
            </div>
            <div className="text-[14px] font-semibold text-text-primary">
              {t("integrations.pageTitle")}
            </div>
            <div className="text-[12px] text-text-muted">
              {t("integrations.tools", { count: integrations.length })}
            </div>
          </div>
          {connectedCount > 0 && (
            <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-success)]">
              <Check size={14} />
              {t("integrations.connected", { count: connectedCount })}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Search */}
        <div className="mb-4 relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("integrations.searchPlaceholder")}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-surface-1 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 mb-6 overflow-x-auto no-scrollbar">
          {filterTabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[12px] transition-colors shrink-0",
                statusFilter === tab.id
                  ? "text-text-primary font-medium bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                  : "text-text-muted hover:text-text-secondary font-normal",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "ml-1 text-[10px] tabular-nums",
                  statusFilter === tab.id
                    ? "text-text-secondary"
                    : "text-text-muted/40",
                )}
              >
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-text-muted" />
          </div>
        )}

        {/* Grid */}
        {!isLoading && (
          <div className="grid sm:grid-cols-2 gap-4">
            {filtered.map((integration) => (
              <IntegrationCard
                key={integration.toolkit.slug}
                integration={integration}
                onConnect={(slug, credentials) => {
                  const isOAuth =
                    filtered.find((i) => i.toolkit.slug === slug)?.toolkit
                      .authScheme === "oauth2";
                  oauthTabRef.current = isOAuth
                    ? window.open("about:blank", "_blank")
                    : null;
                  connectMutation.mutate({ slug, credentials });
                }}
                onDisconnect={() => {
                  setDisconnectTarget(integration);
                }}
                isConnecting={
                  connectMutation.isPending &&
                  connectMutation.variables?.slug === integration.toolkit.slug
                }
                expandedSlug={expandedSlug}
                onToggleExpand={(slug) =>
                  setExpandedSlug((prev) => (prev === slug ? null : slug))
                }
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="flex justify-center items-center mx-auto mb-3 w-12 h-12 rounded-xl bg-accent/10">
              <Puzzle size={20} className="text-accent" />
            </div>
            <p className="text-[13px] text-text-muted">
              {query.trim()
                ? t("integrations.noMatchSearch")
                : t("integrations.noAvailable")}
            </p>
          </div>
        )}
      </div>

      {/* Disconnect confirmation dialog */}
      {disconnectTarget?.id != null && (
        <DisconnectDialog
          name={disconnectTarget.toolkit.displayName}
          onConfirm={() => {
            const id = disconnectTarget.id;
            if (id) disconnectMutation.mutate(id);
          }}
          onCancel={() => setDisconnectTarget(null)}
          isPending={disconnectMutation.isPending}
        />
      )}
    </div>
  );
}
