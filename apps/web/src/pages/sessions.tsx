import { track } from "@/lib/tracking";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Code2,
  ExternalLink,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { getApiV1Artifacts, getApiV1SessionsById } from "../../lib/api/sdk.gen";

type Platform = "slack" | "discord" | "whatsapp" | "telegram" | "web";

const PLATFORM_CONFIG: Record<
  Platform,
  { bg: string; emoji: string; label: string }
> = {
  slack: { bg: "bg-purple-500/15", emoji: "#", label: "Slack" },
  discord: { bg: "bg-indigo-500/15", emoji: "\uD83C\uDFAE", label: "Discord" },
  whatsapp: {
    bg: "bg-emerald-500/15",
    emoji: "\uD83D\uDCAC",
    label: "WhatsApp",
  },
  telegram: { bg: "bg-blue-500/15", emoji: "\u2708\uFE0F", label: "Telegram" },
  web: { bg: "bg-gray-500/15", emoji: "\uD83C\uDF10", label: "Web" },
};

const STATUS_CONFIG: Record<
  string,
  { icon: typeof CheckCircle2; color: string }
> = {
  live: { icon: CheckCircle2, color: "text-emerald-500" },
  building: { icon: Loader2, color: "text-yellow-500 animate-spin" },
  failed: { icon: AlertTriangle, color: "text-red-500" },
};

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-3">
          <MessageSquare className="h-8 w-8 text-text-muted" />
        </div>
        <h3 className="mb-2 text-lg font-medium text-text-primary">
          Select a session
        </h3>
        <p className="max-w-sm text-sm text-text-muted">
          Pick a session from the sidebar to view details, or start a
          conversation through your connected channels.
        </p>
      </div>
    </div>
  );
}

function MetaTag({
  children,
  className = "",
}: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}

export function SessionsPage() {
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    if (id) track("session_detail_view");
  }, [id]);

  const { data: session } = useQuery({
    queryKey: ["session", id],
    queryFn: async () => {
      if (!id) {
        throw new Error("Session id is required");
      }
      const { data } = await getApiV1SessionsById({ path: { id } });
      return data;
    },
    enabled: !!id,
  });

  const { data: artifactsData } = useQuery({
    queryKey: ["artifacts", session?.sessionKey],
    queryFn: async () => {
      const { data } = await getApiV1Artifacts({
        query: { sessionKey: session?.sessionKey },
      });
      return data;
    },
    enabled: !!session?.sessionKey,
  });

  if (!id) {
    return <EmptyState />;
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Loading...
      </div>
    );
  }

  const platform = (session.channelType ?? "web") as Platform;
  const platformCfg = PLATFORM_CONFIG[platform] ?? PLATFORM_CONFIG.web;
  const artifacts = artifactsData?.artifacts ?? [];
  const codingArtifacts = artifacts.filter(
    (a: { source: string }) => a.source === "coding",
  );

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 md:p-8 mx-auto max-w-5xl">
      {/* Header */}
      <div className="flex gap-3 items-start sm:items-center mb-5 sm:mb-6">
        <div
          className={`flex justify-center items-center rounded-lg ${platformCfg.bg}`}
          style={{ width: 32, height: 32 }}
        >
          <span className="text-sm">{platformCfg.emoji}</span>
        </div>
        <div className="flex-1">
          <div className="flex gap-2.5 items-center">
            <h1 className="text-lg font-bold text-text-primary">
              {session.title}
            </h1>
          </div>
          <div className="flex gap-1.5 items-center mt-1.5">
            <MetaTag className="bg-accent/10 text-accent">
              {platformCfg.emoji} {platformCfg.label}
            </MetaTag>
            <MetaTag
              className={
                session.status === "active"
                  ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-surface-3 text-text-muted"
              }
            >
              {session.status === "active" ? "Active" : session.status}
            </MetaTag>
            <span className="text-[11px] text-text-muted">
              {session.messageCount} messages
              {(session.lastMessageAt || session.updatedAt) &&
                ` \u00B7 ${formatTime(session.lastMessageAt || session.updatedAt)}`}
              {session.createdAt &&
                ` \u00B7 Created ${formatTime(session.createdAt)}`}
            </span>
          </div>
        </div>
      </div>

      {/* Deployments */}
      <div className="space-y-4">
        <div className="flex gap-2 items-center">
          <Code2 size={14} className="text-accent" />
          <h3 className="text-[13px] font-semibold text-text-primary">
            Deployments
          </h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-accent/15 text-accent">
            {codingArtifacts.length}
          </span>
        </div>

        <div className="rounded-xl border bg-surface-1 border-border">
          {codingArtifacts.length === 0 ? (
            <div className="text-[13px] text-text-muted py-8 text-center">
              No deployments yet
            </div>
          ) : (
            <div>
              {codingArtifacts.map(
                (d: {
                  id: string;
                  status: string;
                  title: string;
                  createdAt: string;
                  linesOfCode: number;
                  contentType: string;
                  previewUrl: string;
                }) => {
                  const sc = STATUS_CONFIG[d.status];
                  const Icon = sc?.icon ?? CheckCircle2;
                  const iconColor = sc?.color ?? "text-text-muted";

                  return (
                    <div
                      key={d.id}
                      className="flex flex-wrap items-start gap-3 px-4 py-3.5 border-b border-border last:border-0 sm:flex-nowrap sm:items-center sm:gap-4 sm:px-5"
                    >
                      <Icon size={14} className={iconColor} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-text-primary truncate">
                          {d.title}
                        </div>
                        <div className="text-[11px] text-text-muted mt-0.5">
                          {formatDate(d.createdAt)}
                          {d.linesOfCode > 0 &&
                            ` \u00B7 ${d.linesOfCode} lines`}
                          {d.contentType && ` \u00B7 ${d.contentType}`}
                        </div>
                      </div>
                      {d.previewUrl && (
                        <a
                          href={d.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-emerald-600 shrink-0 hover:underline"
                          onClick={() => track("channel_detail_deploy_preview")}
                        >
                          Preview <ExternalLink size={9} className="inline" />
                        </a>
                      )}
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
