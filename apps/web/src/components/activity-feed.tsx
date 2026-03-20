import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { getApiV1Sessions } from "../../lib/api/sdk.gen";

/**
 * Activity Feed component showing recent session activity.
 *
 * Design spec: design-system PR #85
 * - Shows recent conversations as activity items
 * - Each item has status dot, title, channel badge, and timestamp
 */

interface Session {
  id: string;
  title: string;
  channelType: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  status: string | null;
}

function formatRelativeTime(
  date: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!date) return "";
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("home.justActive");
  if (minutes < 60) return t("home.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("home.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("home.daysAgo", { count: days });
}

const CHANNEL_LABELS: Record<string, string> = {
  feishu: "飞书",
  slack: "Slack",
  discord: "Discord",
  web: "Web",
};

export function ActivityFeed() {
  const { t } = useTranslation();

  const { data: sessionsData, isLoading } = useQuery({
    queryKey: ["sessions-recent"],
    queryFn: async () => {
      const { data } = await getApiV1Sessions({ query: { limit: 5 } });
      return data;
    },
    refetchInterval: 30000, // Refresh every 30s
  });

  const sessions = (sessionsData?.sessions ?? []) as Session[];

  // Filter to recent sessions with activity
  const recentSessions = sessions
    .filter((s) => s.lastMessageAt)
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt ?? 0).getTime() -
        new Date(a.lastMessageAt ?? 0).getTime(),
    )
    .slice(0, 5);

  if (isLoading) {
    return (
      <div className="card card-static p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t("home.recentActivity")}
          </h3>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 animate-pulse">
              <div className="w-1.5 h-1.5 rounded-full bg-surface-4 mt-2 shrink-0" />
              <div className="flex-1">
                <div className="h-4 bg-surface-3 rounded w-3/4 mb-2" />
                <div className="h-3 bg-surface-3 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (recentSessions.length === 0) {
    return (
      <div className="card card-static p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t("home.recentActivity")}
          </h3>
        </div>
        <div className="text-center py-6">
          <p className="text-[13px] text-text-muted">
            {t("home.noRecentActivity")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card card-static p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-semibold text-text-primary">
          {t("home.recentActivity")}
        </h3>
      </div>
      <div className="space-y-5">
        {recentSessions.map((session) => (
          <Link
            key={session.id}
            data-activity-session-link={session.id}
            to={`/workspace/sessions/${session.id}`}
            className="group -mx-2 block rounded-xl px-2 py-2 transition-colors hover:bg-surface-1"
          >
            <div className="flex items-start gap-3">
              <div
                className={`w-1.5 h-1.5 rounded-full mt-[7px] shrink-0 ${
                  session.status === "active"
                    ? "bg-[var(--color-success)]"
                    : "bg-surface-4"
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-text-primary leading-relaxed truncate group-hover:text-accent">
                  {session.title}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  {session.channelType && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface-2 text-text-muted">
                      {CHANNEL_LABELS[session.channelType] ??
                        session.channelType}
                    </span>
                  )}
                  <span className="text-[10px] text-text-muted">
                    {formatRelativeTime(session.lastMessageAt, t)}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
