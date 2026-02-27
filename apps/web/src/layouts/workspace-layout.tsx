import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  LogOut,
  MessageCircle,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import "@/lib/api";
import { getV1Bots, getV1Sessions } from "../../lib/api/sdk.gen";

const CHANNEL_ICONS: Record<string, string> = {
  slack: "\uD83D\uDCAC",
  discord: "\uD83C\uDFAE",
  telegram: "\u2708\uFE0F",
  web: "\uD83C\uDF10",
  whatsapp: "\uD83D\uDCF1",
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

export function WorkspaceLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();

  const { data: botsData } = useQuery({
    queryKey: ["bots"],
    queryFn: async () => {
      const { data } = await getV1Bots();
      return data;
    },
  });

  const botId = botsData?.bots?.[0]?.id;

  const { data: sessionsData } = useQuery({
    queryKey: ["sessions", botId],
    queryFn: async () => {
      const { data } = await getV1Sessions({
        query: { botId, limit: 100 },
      });
      return data;
    },
    enabled: !!botId,
    refetchInterval: 5000,
  });

  const sessions = sessionsData?.sessions ?? [];

  // Extract selected session ID from URL
  const sessionMatch = location.pathname.match(/\/workspace\/sessions\/(.+)/);
  const selectedSessionId = sessionMatch?.[1] ?? null;

  const handleLogout = async () => {
    await authClient.signOut();
    window.location.href = "/";
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r bg-muted/30 transition-all",
          collapsed ? "w-16" : "w-64",
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center justify-between border-b px-4">
          {!collapsed && (
            <Link to="/" className="text-lg font-bold">
              Nexu
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Sessions */}
        <div className="flex-1 overflow-y-auto p-2">
          {!collapsed && (
            <p className="mb-2 px-2 text-xs font-medium uppercase text-muted-foreground">
              Sessions
            </p>
          )}
          {sessions.length === 0 && !collapsed && (
            <p className="px-2 text-sm text-muted-foreground">
              No sessions yet
            </p>
          )}
          {sessions.map((s) => {
            const isActive = selectedSessionId === s.id;
            const channelIcon =
              s.channelType && CHANNEL_ICONS[s.channelType]
                ? CHANNEL_ICONS[s.channelType]
                : null;

            return (
              <button
                type="button"
                key={s.id}
                onClick={() => navigate(`/workspace/sessions/${s.id}`)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent",
                )}
              >
                {collapsed ? (
                  <MessageCircle className="mx-auto h-4 w-4" />
                ) : (
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "truncate text-sm font-medium",
                          !isActive && "text-foreground",
                        )}
                      >
                        {s.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          className={cn(
                            "text-xs",
                            isActive
                              ? "text-primary-foreground/70"
                              : "text-muted-foreground",
                          )}
                        >
                          {formatTime(s.lastMessageAt || s.updatedAt)}
                        </span>
                        {channelIcon && (
                          <>
                            <span
                              className={cn(
                                "text-xs",
                                isActive
                                  ? "text-primary-foreground/50"
                                  : "text-muted-foreground",
                              )}
                            >
                              ·
                            </span>
                            <span
                              className="text-xs"
                              title={s.channelType ?? ""}
                            >
                              {channelIcon}
                            </span>
                          </>
                        )}
                        {(s.messageCount ?? 0) > 0 && (
                          <>
                            <span
                              className={cn(
                                "text-xs",
                                isActive
                                  ? "text-primary-foreground/50"
                                  : "text-muted-foreground",
                              )}
                            >
                              ·
                            </span>
                            <span
                              className={cn(
                                "font-mono text-xs",
                                isActive
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground",
                              )}
                            >
                              {s.messageCount} msgs
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        s.status === "active"
                          ? "bg-emerald-500"
                          : "bg-gray-300",
                      )}
                    />
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <Separator />

        {/* Nav */}
        <nav className="p-2">
          <Link
            to="/workspace/channels"
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
              location.pathname.includes("/channels") && "bg-accent",
            )}
          >
            <Settings className="h-4 w-4" />
            {!collapsed && "Channel Config"}
          </Link>
        </nav>

        <Separator />

        {/* User */}
        <div className="flex items-center gap-2 p-3">
          {!collapsed && (
            <span className="flex-1 truncate text-sm text-muted-foreground">
              {session?.user?.email}
            </span>
          )}
          <Button variant="ghost" size="icon" onClick={handleLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
