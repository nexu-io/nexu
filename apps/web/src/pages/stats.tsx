import "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Calendar, CalendarDays, Radio, RefreshCw, Users } from "lucide-react";
import type { ReactNode } from "react";
import { getApiStatsUsers } from "../../lib/api/sdk.gen";

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function getErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return "Failed to load user statistics";
}

function StatsCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-1 p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[12px] font-medium text-text-muted">{title}</div>
        <div className="rounded-md bg-accent/10 p-2 text-accent">{icon}</div>
      </div>
      <div className="text-3xl font-bold text-text-primary">
        {formatCount(value)}
      </div>
    </div>
  );
}

export function StatsPage() {
  const {
    data: stats,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["user-stats"],
    queryFn: async () => {
      const { data, error } = await getApiStatsUsers();
      if (error) {
        throw new Error(getErrorMessage(error));
      }
      if (!data) {
        throw new Error("Failed to load user statistics");
      }
      return data;
    },
    refetchInterval: 30000,
    refetchIntervalInBackground: true,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6 md:p-8">
        <h1 className="mb-6 text-lg font-bold text-text-primary">Statistics</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static loading placeholders
              key={index}
              className="h-[140px] animate-pulse rounded-xl border border-border bg-surface-1"
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6 sm:py-6 md:p-8">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5">
          <h1 className="text-lg font-bold text-text-primary">Statistics</h1>
          <p className="mt-2 text-sm text-text-muted">
            Failed to load user statistics.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-fg hover:bg-accent-hover"
          >
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 sm:py-6 md:p-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Statistics</h1>
          <p className="mt-1 text-[13px] text-text-muted">
            User growth snapshot. Auto-refresh every 30 seconds.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-border-hover hover:bg-surface-2 hover:text-text-primary"
        >
          <RefreshCw size={14} className={isRefetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatsCard
          title="Total users"
          value={stats.totalUsers}
          icon={<Users size={14} />}
        />
        <StatsCard
          title="New today"
          value={stats.todayNewUsers}
          icon={<Calendar size={14} />}
        />
        <StatsCard
          title="New in 7 days"
          value={stats.last7DaysNewUsers}
          icon={<CalendarDays size={14} />}
        />
        <StatsCard
          title="New in 30 days"
          value={stats.last30DaysNewUsers}
          icon={<CalendarDays size={14} />}
        />
        <StatsCard
          title="Total channels"
          value={stats.totalChannels}
          icon={<Radio size={14} />}
        />
      </div>
    </div>
  );
}
