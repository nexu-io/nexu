import { ToolkitIcon } from "@/components/toolkit-icon";
import { cn } from "@/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bot,
  Calendar,
  Check,
  Code,
  Copy,
  DollarSign,
  ExternalLink,
  FileText,
  Globe,
  HardDrive,
  Image,
  Link2,
  Loader2,
  Mail,
  Map as MapIcon,
  MessageSquare,
  Mic,
  Newspaper,
  Palette,
  PenTool,
  Phone,
  Search,
  Sparkles,
  Table,
  Trash2,
  Unplug,
  UserSearch,
  Users,
  Video,
} from "lucide-react";
import type { ElementType } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import "@/lib/api";
import {
  deleteApiV1IntegrationsByIntegrationId,
  getApiV1SkillsBySlug,
  postApiV1IntegrationsByIntegrationIdRefresh,
  postApiV1IntegrationsConnect,
} from "../../lib/api/sdk.gen";

// ─── Types ──────────────────────────────────────────────────

type SkillDetail = NonNullable<
  Awaited<ReturnType<typeof getApiV1SkillsBySlug>>["data"]
>;

type SkillTool = NonNullable<SkillDetail["tools"]>[number];

type RelatedSkill = NonNullable<SkillDetail["relatedSkills"]>[number];

// ─── Tag labels ─────────────────────────────────────────────

const TAG_LABELS: Record<string, string> = {
  "office-collab": "Office & Collaboration",
  "file-knowledge": "File & Knowledge",
  "creative-design": "Creative & Design",
  "biz-analysis": "Business & Analysis",
  "av-generation": "A/V Generation",
  "info-content": "Info & Content",
  "dev-tools": "Developer Tools",
};

// ─── Icon map ───────────────────────────────────────────────

const ICON_MAP: Record<string, ElementType> = {
  Mail,
  Calendar,
  MessageSquare,
  Search,
  BarChart3,
  Image,
  Palette,
  FileText,
  Users,
  Link2,
  Video,
  Globe,
  Map: MapIcon,
  Table,
  HardDrive,
  Mic,
  Sparkles,
  Bot,
  DollarSign,
  UserSearch,
  Phone,
  PenTool,
  Newspaper,
  Code,
};

function SkillLucideIcon({
  iconName,
  size = "md",
}: {
  iconName: string;
  size?: "sm" | "md" | "lg";
}) {
  const Icon = ICON_MAP[iconName] ?? Sparkles;
  const sizeClasses = {
    sm: "w-8 h-8 rounded-lg",
    md: "w-10 h-10 rounded-xl",
    lg: "w-14 h-14 rounded-2xl",
  };
  const iconSizes = { sm: 16, md: 18, lg: 28 };
  return (
    <div
      className={cn(
        "bg-accent/10 flex items-center justify-center shrink-0",
        sizeClasses[size],
      )}
    >
      <Icon size={iconSizes[size]} className="text-accent" />
    </div>
  );
}

// ─── Platform icons ─────────────────────────────────────────

function SlackIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <title>Slack</title>
      <path
        d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
        fill="#E01E5A"
      />
      <path
        d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
        fill="#36C5F0"
      />
      <path
        d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
        fill="#2EB67D"
      />
      <path
        d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z"
        fill="#ECB22E"
      />
    </svg>
  );
}

function DiscordIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#5865F2">
      <title>Discord</title>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

function TelegramIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#26A5E4">
      <title>Telegram</title>
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
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
              Disconnect {name}?
            </h3>
            <p className="text-[12px] text-text-muted">
              This will remove the connection and any stored credentials.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-surface-3 transition-colors"
          >
            Cancel
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
            Disconnect
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tool Auth Card ─────────────────────────────────────────

function ToolAuthCard({
  tool,
  onConnect,
  onDisconnect,
  isConnecting,
}: {
  tool: SkillTool;
  onConnect: () => void;
  onDisconnect: () => void;
  isConnecting: boolean;
}) {
  const isConnected = tool.status === "connected";

  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-surface-1 hover:border-border-hover transition-colors">
      <div className="flex items-center gap-4">
        <ToolkitIcon
          iconUrl={tool.iconUrl}
          fallbackIconUrl={tool.fallbackIconUrl}
          name={tool.name}
          size="lg"
        />
        <div>
          <div className="text-[14px] font-semibold text-text-primary">
            {tool.name}
          </div>
          <div className="text-[12px] text-text-muted">
            {tool.provider} ·{" "}
            {tool.authScheme === "oauth2" ? "OAuth 2.0" : tool.authScheme}
          </div>
        </div>
      </div>
      {isConnected ? (
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 text-[12px] text-emerald-600 font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10">
            <Check size={12} /> Connected
          </span>
          <button
            type="button"
            onClick={onDisconnect}
            className="text-[11px] text-text-muted hover:text-red-500 transition-colors"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          disabled={isConnecting}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-[12px] font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {isConnecting ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <ExternalLink size={12} />
              Connect
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ─── Related Skill Card ─────────────────────────────────────

function RelatedSkillCard({ skill }: { skill: RelatedSkill }) {
  return (
    <Link
      to={`/workspace/skills/${skill.slug}`}
      className="group flex flex-col p-4 rounded-xl border border-border bg-surface-1 hover:border-accent/30 hover:shadow-md hover:shadow-accent/5 transition-all"
    >
      <div className="flex items-center gap-2.5 mb-2">
        {skill.iconUrl ? (
          <ToolkitIcon
            iconUrl={skill.iconUrl}
            fallbackIconUrl={skill.fallbackIconUrl}
            name={skill.name}
            size="sm"
          />
        ) : (
          <SkillLucideIcon iconName={skill.iconName} size="sm" />
        )}
        <span className="text-[13px] font-semibold text-text-primary group-hover:text-accent transition-colors">
          {skill.name}
        </span>
      </div>
      <p className="text-[12px] text-text-muted leading-relaxed line-clamp-2">
        {skill.description}
      </p>
      {skill.tools && skill.tools.length > 0 && (
        <div className="flex gap-1.5 mt-3">
          {skill.tools.map((t) => (
            <span
              key={t.slug}
              className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted font-medium"
            >
              {t.provider}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export function SkillDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();

  const [copiedPrompt, setCopiedPrompt] = useState<number | null>(null);
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<SkillTool | null>(
    null,
  );

  const pollingRef = useRef<{
    integrationId: string;
    state: string;
    timer: ReturnType<typeof setInterval>;
  } | null>(null);
  const oauthTabRef = useRef<Window | null>(null);

  const {
    data: skill,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["skill", slug],
    queryFn: async () => {
      const { data } = await getApiV1SkillsBySlug({
        path: { slug: slug ?? "" },
      });
      return data;
    },
    enabled: !!slug,
  });

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current.timer);
    };
  }, []);

  const startPolling = useCallback(
    (integrationId: string, state: string) => {
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
            setConnectingSlug(null);
            toast.success(
              `${refreshed.toolkit.displayName} connected successfully`,
            );
            queryClient.invalidateQueries({ queryKey: ["skill", slug] });
          } else if (attempts >= 20) {
            clearInterval(timer);
            pollingRef.current = null;
            setConnectingSlug(null);
            toast.error("Connection timed out. Please try again.");
            queryClient.invalidateQueries({ queryKey: ["skill", slug] });
          }
        } catch {
          clearInterval(timer);
          pollingRef.current = null;
          setConnectingSlug(null);
          toast.error("Failed to verify connection status");
          queryClient.invalidateQueries({ queryKey: ["skill", slug] });
        }
      }, 3000);
      pollingRef.current = { integrationId, state, timer };
    },
    [queryClient, slug],
  );

  const connectMutation = useMutation({
    mutationFn: async (toolkitSlug: string) => {
      const { data } = await postApiV1IntegrationsConnect({
        body: {
          toolkitSlug,
          source: "page",
          returnTo: `/workspace/skills/${slug}`,
        },
      });
      return data;
    },
    onSuccess: (result) => {
      if (!result) {
        oauthTabRef.current?.close();
        oauthTabRef.current = null;
        return;
      }
      if (result.connectUrl) {
        if (result.integration.id && result.state) {
          localStorage.setItem(
            `nexu-oauth-pending-${result.integration.id}`,
            JSON.stringify({ state: result.state }),
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
          setConnectingSlug(null);
          toast.success(
            `${result.integration.toolkit.displayName} connected successfully`,
          );
          queryClient.invalidateQueries({ queryKey: ["skill", slug] });
        }
      }
    },
    onError: () => {
      oauthTabRef.current?.close();
      oauthTabRef.current = null;
      setConnectingSlug(null);
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
      toast.success(`${disconnectTarget?.name ?? "Integration"} disconnected`);
      setDisconnectTarget(null);
      queryClient.invalidateQueries({ queryKey: ["skill", slug] });
    },
    onError: () => {
      toast.error("Failed to disconnect. Please try again.");
    },
  });

  const handleConnect = (toolSlug: string) => {
    const tool = skill?.tools?.find((t) => t.slug === toolSlug);
    const isOAuth = tool?.authScheme === "oauth2";
    oauthTabRef.current = isOAuth ? window.open("about:blank", "_blank") : null;
    setConnectingSlug(toolSlug);
    connectMutation.mutate(toolSlug);
  };

  const handleCopyPrompt = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(idx);
    setTimeout(() => setCopiedPrompt(null), 3000);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-full bg-surface-0 flex justify-center py-32">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    );
  }

  // Error / not found
  if (error || !skill) {
    return (
      <div className="min-h-full bg-surface-0 flex items-center justify-center">
        <div className="text-center">
          <div className="flex justify-center items-center mx-auto mb-3 w-12 h-12 rounded-xl bg-accent/10">
            <Search size={20} className="text-accent" />
          </div>
          <h1 className="text-lg font-bold text-text-primary mb-2">
            Skill not found
          </h1>
          <p className="text-[13px] text-text-muted mb-6">
            This skill does not exist or has been removed.
          </p>
          <Link
            to="/workspace/skills"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent-hover transition-colors"
          >
            <ArrowLeft size={14} />
            Back to Skills
          </Link>
        </div>
      </div>
    );
  }

  const hasTools = !!skill.tools?.length;
  const categoryLabel = TAG_LABELS[skill.tag] ?? skill.tag;

  return (
    <div className="min-h-full bg-surface-0">
      {/* ── Sticky header with back link ───────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-border bg-surface-0/85 backdrop-blur-md">
        <div className="h-14 max-w-4xl mx-auto px-6 flex items-center">
          <Link
            to="/workspace/skills"
            className="flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary transition-colors"
          >
            <ArrowLeft size={14} />
            Back to Skills
          </Link>
        </div>
      </div>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(var(--color-accent-rgb,99,102,241),0.06)_0%,transparent_50%)]" />
        <div className="relative px-6 pt-12 pb-10 mx-auto max-w-4xl">
          <div className="flex flex-col lg:flex-row items-start gap-8">
            {/* Left: info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-5">
                {skill.iconUrl ? (
                  <ToolkitIcon
                    iconUrl={skill.iconUrl}
                    fallbackIconUrl={skill.fallbackIconUrl}
                    name={skill.name}
                    size="lg"
                  />
                ) : (
                  <SkillLucideIcon iconName={skill.iconName} size="lg" />
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-bold text-text-primary">
                      {skill.name}
                    </h1>
                    {hasTools && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-accent/20 text-accent font-medium bg-accent/5">
                        OAuth
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[12px] px-2 py-0.5 rounded-full bg-surface-3 text-text-secondary font-medium">
                      {categoryLabel}
                    </span>
                    {hasTools && (
                      <>
                        <span className="text-[12px] text-text-muted">·</span>
                        <span className="text-[12px] text-text-muted">
                          {skill.tools?.length} tool
                          {(skill.tools?.length ?? 0) > 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-[15px] text-text-secondary leading-relaxed max-w-lg">
                {skill.longDescription || skill.description}
              </p>
            </div>

            {/* Right: quick info card */}
            <div className="w-full lg:w-72 shrink-0 rounded-xl border border-border bg-surface-1 p-5">
              <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">
                Quick Info
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-text-muted">Category</span>
                  <span className="text-[12px] text-text-primary font-medium">
                    {categoryLabel}
                  </span>
                </div>
                <div className="border-t border-border/50" />
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-text-muted">Auth</span>
                  <span className="text-[12px] text-text-primary font-medium">
                    {hasTools ? "OAuth" : "No auth needed"}
                  </span>
                </div>
                <div className="border-t border-border/50" />
                {hasTools && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] text-text-muted">
                        Providers
                      </span>
                      <div className="flex gap-1">
                        {skill.tools?.map((t) => (
                          <span
                            key={t.slug}
                            className="text-[11px] px-2 py-0.5 rounded-md bg-accent/10 text-accent font-medium"
                          >
                            {t.provider}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-border/50" />
                  </>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-text-muted">Platforms</span>
                  <div className="flex items-center gap-2">
                    <SlackIcon size={14} />
                    <DiscordIcon size={14} />
                    <TelegramIcon size={14} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="px-6 mx-auto max-w-4xl">
        <div className="border-t border-border" />
      </div>

      {/* ── Tool Authorization ───────────────────────────────── */}
      {hasTools && (
        <section className="px-6 py-12 mx-auto max-w-4xl">
          <div className="mb-8">
            <div className="text-[11px] font-semibold text-accent mb-2 tracking-widest uppercase">
              Connect
            </div>
            <h2 className="text-xl font-bold text-text-primary mb-2">
              Tool Authorization
            </h2>
            <p className="text-[14px] text-text-muted">
              We manage OAuth, token refresh, and scopes — you just chat.
            </p>
          </div>
          <div className="grid gap-3">
            {skill.tools?.map((tool) => (
              <ToolAuthCard
                key={tool.slug}
                tool={tool}
                onConnect={() => handleConnect(tool.slug)}
                onDisconnect={() => setDisconnectTarget(tool)}
                isConnecting={connectingSlug === tool.slug}
              />
            ))}
          </div>
        </section>
      )}

      {hasTools && (
        <div className="px-6 mx-auto max-w-4xl">
          <div className="border-t border-border" />
        </div>
      )}

      {/* ── Example Prompts ──────────────────────────────────── */}
      {skill.examples && skill.examples.length > 0 && (
        <>
          <section className="px-6 py-12 mx-auto max-w-4xl">
            <div className="mb-8">
              <div className="text-[11px] font-semibold text-accent mb-2 tracking-widest uppercase">
                Examples
              </div>
              <h2 className="text-xl font-bold text-text-primary mb-2">
                Try these prompts
              </h2>
              <p className="text-[14px] text-text-muted">
                Copy a prompt and send it to your Nexu bot to try this skill.
              </p>
            </div>

            <div className="space-y-3">
              {skill.examples.map((example, i) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => handleCopyPrompt(example, i)}
                  className="w-full text-left flex items-center gap-4 p-4 rounded-xl border border-border bg-surface-1 hover:border-accent/40 hover:shadow-sm transition-all group"
                >
                  <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                    <span className="text-[12px] font-bold text-accent">
                      {i + 1}
                    </span>
                  </div>
                  <span className="text-[13px] text-text-secondary flex-1 leading-relaxed">
                    {example}
                  </span>
                  <div
                    className={cn(
                      "shrink-0 flex items-center gap-1 text-[11px] font-medium transition-all",
                      copiedPrompt === i
                        ? "text-emerald-600"
                        : "text-text-muted opacity-0 group-hover:opacity-100",
                    )}
                  >
                    {copiedPrompt === i ? (
                      <>
                        <Check size={12} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={12} /> Copy
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <div className="px-6 mx-auto max-w-4xl">
            <div className="border-t border-border" />
          </div>
        </>
      )}

      {/* ── Related Skills ───────────────────────────────────── */}
      {skill.relatedSkills && skill.relatedSkills.length > 0 && (
        <section className="px-6 py-12 mx-auto max-w-4xl">
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="text-[11px] font-semibold text-accent mb-2 tracking-widest uppercase">
                Explore
              </div>
              <h2 className="text-xl font-bold text-text-primary">
                Related Skills
              </h2>
            </div>
            <Link
              to="/workspace/skills"
              className="text-[13px] text-accent font-medium hover:underline flex items-center gap-1"
            >
              View all skills <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {skill.relatedSkills.map((s) => (
              <RelatedSkillCard key={s.slug} skill={s} />
            ))}
          </div>
        </section>
      )}

      {/* ── Disconnect dialog ────────────────────────────────── */}
      {disconnectTarget?.integrationId != null && (
        <DisconnectDialog
          name={disconnectTarget.name}
          onConfirm={() => {
            const id = disconnectTarget.integrationId;
            if (id) disconnectMutation.mutate(id);
          }}
          onCancel={() => setDisconnectTarget(null)}
          isPending={disconnectMutation.isPending}
        />
      )}
    </div>
  );
}
