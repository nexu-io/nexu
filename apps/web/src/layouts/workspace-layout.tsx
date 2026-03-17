import { BrandMark } from "@/components/brand-mark";
import { authClient } from "@/lib/auth-client";
import { track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronUp,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import "@/lib/api";
import { getApiV1Sessions } from "../../lib/api/sdk.gen";

type Platform = "slack" | "discord" | "whatsapp" | "telegram" | "web";

const PLATFORM_ICON_CONFIG: Record<Platform, { bg: string; emoji: string }> = {
  discord: { bg: "bg-indigo-500/15", emoji: "🎮" },
  slack: { bg: "bg-purple-500/15", emoji: "#" },
  whatsapp: { bg: "bg-emerald-500/15", emoji: "💬" },
  telegram: { bg: "bg-blue-500/15", emoji: "✈️" },
  web: { bg: "bg-gray-500/15", emoji: "🌐" },
};

function SidebarPlatformIcon({ platform }: { platform: string }) {
  const config = PLATFORM_ICON_CONFIG[platform as Platform] ?? {
    bg: "bg-gray-500/15",
    emoji: "💬",
  };
  return (
    <div
      className={`flex justify-center items-center w-6 h-6 rounded-md shrink-0 ${config.bg}`}
    >
      <span className="text-[11px]">{config.emoji}</span>
    </div>
  );
}

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

function EmptyState({ onGoConfig }: { onGoConfig: () => void }) {
  return (
    <div className="flex flex-col justify-center items-center h-full px-8">
      <div className="max-w-md text-center">
        <div className="flex justify-center items-center mx-auto mb-6 w-16 h-16 rounded-2xl bg-accent/10">
          <MessageSquare size={28} className="text-accent" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-text-primary">
          No conversations yet
        </h2>
        <p className="mb-6 text-sm leading-relaxed text-text-muted">
          Set up a platform bot first, then mention @Nexu or DM the lobster 🦞
          in Slack / Discord / WhatsApp — conversations will appear here
          automatically.
        </p>
        <div className="flex flex-col gap-3 items-center">
          <button
            type="button"
            onClick={onGoConfig}
            className="flex gap-2 items-center px-6 py-2.5 text-sm font-medium text-white rounded-lg transition-colors bg-accent hover:bg-accent-hover"
          >
            <Settings size={14} /> Set up Bot
          </button>
          <div className="flex gap-4 mt-2">
            {[
              { step: "1", text: "Connect a platform" },
              { step: "2", text: "Mention @Nexu" },
              { step: "3", text: "Conversations appear" },
            ].map((s, i) => (
              <div
                key={s.step}
                className="flex gap-1.5 items-center text-[12px] text-text-muted"
              >
                {i > 0 && <span className="text-border mr-1">→</span>}
                <span className="flex justify-center items-center w-4 h-4 rounded-full bg-accent/10 text-[10px] font-semibold text-accent">
                  {s.step}
                </span>
                {s.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const SETUP_COMPLETE_KEY = "nexu_setup_complete";

export function WorkspaceLayout() {
  if (localStorage.getItem(SETUP_COMPLETE_KEY) !== "1") {
    return <Navigate to="/" replace />;
  }

  return <WorkspaceLayoutInner />;
}

function WorkspaceLayoutInner() {
  const isDesktopClient = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Electron"),
    [],
  );
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const logoutRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();

  useEffect(() => {
    track("workspace_view");
  }, []);

  useEffect(() => {
    if (!showLogoutConfirm) return;
    const handler = (e: MouseEvent) => {
      if (logoutRef.current && !logoutRef.current.contains(e.target as Node)) {
        setShowLogoutConfirm(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLogoutConfirm]);

  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [mobileDrawerOpen]);

  const { data: sessionsData } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data } = await getApiV1Sessions({
        query: { limit: 100 },
      });
      return data;
    },
    refetchInterval: 5000,
  });

  const sessions = sessionsData?.sessions ?? [];

  const sessionMatch = location.pathname.match(/\/workspace\/sessions\/(.+)/);
  const selectedSessionId = sessionMatch?.[1] ?? null;
  const isHomePage =
    location.pathname === "/workspace" ||
    location.pathname === "/workspace/home";
  const isChannelsPage = location.pathname.includes("/channels");
  const isSkillsPage = location.pathname.includes("/skills");
  const isModelsPage = location.pathname.includes("/models");

  const handleLogout = async () => {
    setShowLogoutConfirm(false);
    await authClient.signOut();
    window.location.href = "/";
  };

  const userEmail = session?.user?.email ?? "";
  const userInitial = (userEmail[0] ?? "U").toUpperCase();

  const showEmptyState =
    sessions.length === 0 &&
    !isHomePage &&
    !isChannelsPage &&
    !isSkillsPage &&
    !isModelsPage &&
    !selectedSessionId;

  const selectedSession = selectedSessionId
    ? sessions.find((s) => s.id === selectedSessionId)
    : null;
  const mobileTitle = isHomePage
    ? "Home"
    : isChannelsPage
      ? "Deployments"
      : isSkillsPage
        ? "Skills"
        : isModelsPage
          ? "Settings"
          : selectedSession?.title || "Conversations";
  const mobileSubtitle = isHomePage
    ? "Welcome to nexu"
    : isChannelsPage
      ? "All deployment records"
      : isSkillsPage
        ? "Browse AI capabilities"
        : isModelsPage
          ? "Manage AI model providers"
          : selectedSession
            ? `${selectedSession.channelType ?? "web"} · ${formatTime(selectedSession.lastMessageAt || selectedSession.updatedAt)}`
            : `${sessions.length} conversation${sessions.length === 1 ? "" : "s"}`;

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar */}
      <div
        className={cn(
          "hidden md:flex flex-col shrink-0 border-r border-border bg-surface-1 transition-all duration-200",
          collapsed ? "w-14" : "w-56",
        )}
      >
        {/* Header */}
        <div
          className={cn(
            "flex items-center border-b border-border",
            collapsed ? "px-2 py-3 justify-center" : "px-4 py-3 gap-2.5",
            isDesktopClient && "pt-10",
          )}
        >
          {collapsed ? (
            <div className="relative group">
              <BrandMark className="w-7 h-7 transition-opacity group-hover:opacity-0" />
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                className="absolute inset-0 flex justify-center items-center w-7 h-7 rounded-lg opacity-0 transition-opacity bg-surface-3 text-text-primary group-hover:opacity-100"
                title="Expand sidebar"
              >
                <PanelLeftOpen size={14} />
              </button>
            </div>
          ) : (
            <>
              <BrandMark className="w-7 h-7 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-text-primary">
                  Nexu <span className="text-[11px]">🦞</span>
                </div>
                <div className="text-[10px] text-text-tertiary">
                  Your digital coworker
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="p-1.5 rounded-lg transition-colors text-text-muted hover:text-text-primary hover:bg-surface-3 shrink-0"
                title="Collapse sidebar"
              >
                <PanelLeftClose size={14} />
              </button>
            </>
          )}
        </div>

        {/* Main nav + conversations */}
        <div className="flex-1 overflow-y-auto">
          {/* Nav items */}
          <div className={cn(collapsed ? "px-2" : "px-3", "pt-3 pb-1")}>
            <Link
              to="/workspace/home"
              title={collapsed ? "Home" : undefined}
              onClick={() => track("workspace_home_click")}
              className={cn(
                "flex items-center gap-2 w-full rounded-lg text-[12px] font-medium transition-colors cursor-pointer mt-0.5",
                collapsed ? "justify-center p-2" : "px-3 py-2",
                isHomePage
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-3",
              )}
            >
              <Home size={14} />
              {!collapsed && "Home"}
            </Link>
            <Link
              to="/workspace/channels"
              title={collapsed ? "Deployments" : undefined}
              onClick={() => track("workspace_deployments_click")}
              className={cn(
                "flex items-center gap-2 w-full rounded-lg text-[12px] font-medium transition-colors cursor-pointer mt-0.5",
                collapsed ? "justify-center p-2" : "px-3 py-2",
                isChannelsPage
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-3",
              )}
            >
              <Rocket size={14} />
              {!collapsed && "Deployments"}
            </Link>
            <Link
              to="/workspace/skills"
              title={collapsed ? "Skills" : undefined}
              onClick={() => track("workspace_skills_click")}
              className={cn(
                "flex items-center justify-between w-full rounded-lg text-[12px] font-medium transition-colors cursor-pointer mt-0.5",
                collapsed ? "justify-center p-2" : "px-3 py-2",
                isSkillsPage
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-3",
              )}
            >
              <span className="flex items-center gap-2">
                <Sparkles size={14} />
                {!collapsed && "Skills"}
              </span>
              {!collapsed && (
                <span className="text-[10px] font-medium text-text-muted/60 tabular-nums">
                  {sessions.length > 0 ? sessions.length : ""}
                </span>
              )}
            </Link>
            <Link
              to="/workspace/models"
              title={collapsed ? "Settings" : undefined}
              onClick={() => track("workspace_settings_click")}
              className={cn(
                "flex items-center gap-2 w-full rounded-lg text-[12px] font-medium transition-colors cursor-pointer mt-0.5",
                collapsed ? "justify-center p-2" : "px-3 py-2",
                isModelsPage
                  ? "bg-accent/10 text-accent"
                  : "text-text-muted hover:text-text-primary hover:bg-surface-3",
              )}
            >
              <Settings size={14} />
              {!collapsed && "Settings"}
            </Link>
          </div>

          {/* Conversations section */}
          <div className={cn(collapsed ? "px-2" : "px-3", "pt-2")}>
            <div className="border-t border-border pt-2 mb-1.5" />
            {!collapsed && (
              <div className="px-3 mb-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                Conversations
              </div>
            )}
            <div className="space-y-0.5">
              {sessions.map((s) => {
                const isActive = selectedSessionId === s.id;
                return (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => {
                      track("workspace_channel_click", {
                        channel_type: s.channelType ?? "web",
                      });
                      navigate(`/workspace/sessions/${s.id}`);
                    }}
                    title={collapsed ? (s.title ?? undefined) : undefined}
                    className={cn(
                      "flex items-center gap-2.5 w-full rounded-lg transition-colors cursor-pointer",
                      collapsed
                        ? "justify-center p-2"
                        : "px-2.5 py-2 text-left",
                      isActive
                        ? "bg-accent/10 text-accent"
                        : "text-text-secondary hover:text-text-primary hover:bg-surface-3",
                    )}
                  >
                    {collapsed ? (
                      <SidebarPlatformIcon platform={s.channelType ?? "web"} />
                    ) : (
                      <>
                        <SidebarPlatformIcon
                          platform={s.channelType ?? "web"}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] truncate font-medium">
                            {s.title}
                          </div>
                          <div className="text-[10px] text-text-muted truncate">
                            {formatTime(s.lastMessageAt || s.updatedAt)}
                            {s.channelType && ` · ${s.channelType}`}
                          </div>
                        </div>
                        <div
                          className={cn(
                            "w-1.5 h-1.5 rounded-full shrink-0",
                            s.status === "active"
                              ? "bg-emerald-500"
                              : "bg-text-muted/30",
                          )}
                        />
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Account */}
        <div className="relative" ref={logoutRef}>
          {showLogoutConfirm && (
            <div
              className={cn(
                "absolute z-20",
                collapsed
                  ? "bottom-full left-1/2 -translate-x-1/2 mb-2 w-52"
                  : "bottom-full left-1.5 right-1.5 mb-2",
              )}
            >
              <div className="rounded-xl border bg-surface-1 border-border shadow-xl shadow-black/10 overflow-hidden">
                <div className="px-3.5 py-3 border-b border-border">
                  <div className="text-[12px] font-medium text-text-primary truncate">
                    {userEmail}
                  </div>
                </div>
                <div className="p-1.5">
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[12px] font-medium text-text-muted hover:text-red-500 hover:bg-red-500/5 transition-all cursor-pointer"
                  >
                    <LogOut size={13} />
                    Sign out
                  </button>
                </div>
              </div>
            </div>
          )}

          <div
            className={cn(
              "border-t border-border",
              collapsed ? "px-2 py-2.5" : "px-2 py-2",
            )}
          >
            {collapsed ? (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowLogoutConfirm(!showLogoutConfirm)}
                  className="group"
                  title={userEmail}
                >
                  <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-gradient-to-br from-accent/20 to-accent/5 text-[11px] font-bold text-accent ring-1 ring-accent/10 transition-all group-hover:ring-accent/25">
                    {userInitial}
                  </div>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(!showLogoutConfirm)}
                className="flex gap-2.5 items-center w-full px-2 py-2 rounded-lg transition-all hover:bg-surface-3 cursor-pointer"
              >
                <div className="flex justify-center items-center w-7 h-7 rounded-md bg-gradient-to-br from-accent/20 to-accent/5 text-[10px] font-bold text-accent ring-1 ring-accent/10 shrink-0">
                  {userInitial}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[12px] text-text-primary truncate font-medium">
                    {userEmail}
                  </div>
                </div>
                <ChevronUp
                  size={12}
                  className={cn(
                    "text-text-muted/50 shrink-0 transition-transform duration-150",
                    showLogoutConfirm ? "rotate-0" : "rotate-180",
                  )}
                />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/30"
            onClick={() => {
              setMobileDrawerOpen(false);
              setShowLogoutConfirm(false);
            }}
          />
          <div className="absolute inset-y-0 left-0 w-[84%] max-w-[320px] bg-surface-1 border-r border-border shadow-xl">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2.5 min-w-0">
                  <BrandMark className="w-7 h-7 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text-primary truncate">
                      Nexu <span className="text-[11px]">🦞</span>
                    </div>
                    <div className="text-[10px] text-text-tertiary">
                      Your digital coworker
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileDrawerOpen(false)}
                  className="p-1.5 rounded-lg transition-colors text-text-muted hover:text-text-primary hover:bg-surface-3"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {/* Nav items */}
                <div className="px-3 pt-3 pb-1">
                  <Link
                    to="/workspace/home"
                    onClick={() => {
                      track("workspace_home_click");
                      setMobileDrawerOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-2 w-full rounded-lg text-[12px] font-medium transition-colors cursor-pointer mt-0.5 px-3 py-2",
                      isHomePage
                        ? "bg-accent/10 text-accent"
                        : "text-text-muted hover:text-text-primary hover:bg-surface-3",
                    )}
                  >
                    <Home size={14} />
                    Home
                  </Link>
                  <Link
                    to="/workspace/channels"
                    onClick={() => {
                      track("workspace_deployments_click");
                      setMobileDrawerOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-2 w-full rounded-lg text-[12px] font-medium transition-colors cursor-pointer mt-0.5 px-3 py-2",
                      isChannelsPage
                        ? "bg-accent/10 text-accent"
                        : "text-text-muted hover:text-text-primary hover:bg-surface-3",
                    )}
                  >
                    <Rocket size={14} />
                    Deployments
                  </Link>
                  <Link
                    to="/workspace/skills"
                    onClick={() => {
                      track("workspace_skills_click");
                      setMobileDrawerOpen(false);
                    }}
                    className={cn(
                      "flex items-center justify-between w-full rounded-lg text-[12px] font-medium transition-colors cursor-pointer mt-0.5 px-3 py-2",
                      isSkillsPage
                        ? "bg-accent/10 text-accent"
                        : "text-text-muted hover:text-text-primary hover:bg-surface-3",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Sparkles size={14} />
                      Skills
                    </span>
                    <span className="text-[10px] font-medium text-text-muted/60 tabular-nums">
                      {sessions.length > 0 ? sessions.length : ""}
                    </span>
                  </Link>
                  <Link
                    to="/workspace/models"
                    onClick={() => {
                      track("workspace_settings_click");
                      setMobileDrawerOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-2 w-full rounded-lg text-[12px] font-medium transition-colors cursor-pointer mt-0.5 px-3 py-2",
                      isModelsPage
                        ? "bg-accent/10 text-accent"
                        : "text-text-muted hover:text-text-primary hover:bg-surface-3",
                    )}
                  >
                    <Settings size={14} />
                    Settings
                  </Link>
                </div>

                {/* Conversations section */}
                <div className="px-3 pt-2 pb-3">
                  <div className="border-t border-border pt-2 mb-1.5" />
                  <div className="px-3 mb-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                    Conversations
                  </div>
                  <div className="space-y-0.5">
                    {sessions.map((s) => {
                      const isActive = selectedSessionId === s.id;
                      return (
                        <button
                          type="button"
                          key={s.id}
                          onClick={() => {
                            track("workspace_channel_click", {
                              channel_type: s.channelType ?? "web",
                            });
                            setMobileDrawerOpen(false);
                            navigate(`/workspace/sessions/${s.id}`);
                          }}
                          className={cn(
                            "flex items-center gap-2.5 w-full rounded-lg transition-colors cursor-pointer px-2.5 py-2 text-left",
                            isActive
                              ? "bg-accent/10 text-accent"
                              : "text-text-secondary hover:text-text-primary hover:bg-surface-3",
                          )}
                        >
                          <SidebarPlatformIcon
                            platform={s.channelType ?? "web"}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] truncate font-medium">
                              {s.title}
                            </div>
                            <div className="text-[10px] text-text-muted truncate">
                              {formatTime(s.lastMessageAt || s.updatedAt)}
                              {s.channelType && ` · ${s.channelType}`}
                            </div>
                          </div>
                          <div
                            className={cn(
                              "w-1.5 h-1.5 rounded-full shrink-0",
                              s.status === "active"
                                ? "bg-emerald-500"
                                : "bg-text-muted/30",
                            )}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div
                className="relative border-t border-border p-2"
                ref={logoutRef}
              >
                {showLogoutConfirm && (
                  <div className="absolute bottom-full left-2 right-2 mb-2 z-20">
                    <div className="rounded-xl border bg-surface-1 border-border shadow-xl shadow-black/10 overflow-hidden">
                      <div className="px-3.5 py-3 border-b border-border">
                        <div className="text-[12px] font-medium text-text-primary truncate">
                          {userEmail}
                        </div>
                      </div>
                      <div className="p-1.5">
                        <button
                          type="button"
                          onClick={handleLogout}
                          className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[12px] font-medium text-text-muted hover:text-red-500 hover:bg-red-500/5 transition-all cursor-pointer"
                        >
                          <LogOut size={13} />
                          Sign out
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setShowLogoutConfirm(!showLogoutConfirm)}
                  className="flex gap-2.5 items-center w-full px-2 py-2 rounded-lg transition-all hover:bg-surface-3 cursor-pointer"
                >
                  <div className="flex justify-center items-center w-7 h-7 rounded-md bg-gradient-to-br from-accent/20 to-accent/5 text-[10px] font-bold text-accent ring-1 ring-accent/10 shrink-0">
                    {userInitial}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="text-[12px] text-text-primary truncate font-medium">
                      {userEmail}
                    </div>
                  </div>
                  <ChevronUp
                    size={12}
                    className={cn(
                      "text-text-muted/50 shrink-0 transition-transform duration-150",
                      showLogoutConfirm ? "rotate-0" : "rotate-180",
                    )}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 bg-surface-0 flex flex-col">
        <div className="md:hidden sticky top-0 z-30 border-b border-border bg-surface-0/95 backdrop-blur px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-surface-2 hover:text-text-primary"
              aria-label="Open menu"
            >
              <Menu size={16} />
            </button>
            <div className="min-w-0 flex-1 text-center leading-tight">
              <div className="text-[13px] font-semibold text-text-primary truncate">
                {mobileTitle}
              </div>
              <div className="text-[10px] text-text-muted truncate mt-0.5">
                {mobileSubtitle}
              </div>
            </div>
            <div className="w-9" />
          </div>
        </div>

        <main className="flex-1 overflow-y-auto min-h-0">
          {showEmptyState ? (
            <EmptyState onGoConfig={() => navigate("/workspace/channels")} />
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}
