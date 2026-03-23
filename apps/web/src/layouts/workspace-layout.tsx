import { BrandMark } from "@/components/brand-mark";
import { PlatformIcon } from "@/components/platform-icons";
import { useAutoUpdate } from "@/hooks/use-auto-update";
import { useCommunitySkills } from "@/hooks/use-community-catalog";
import { type Locale, useLocale } from "@/hooks/use-locale";
import { authClient } from "@/lib/auth-client";
import { normalizeChannel, track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  ChevronUp,
  CircleHelp,
  Globe,
  Home,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import "@/lib/api";
import { getApiV1Me, getApiV1Sessions } from "../../lib/api/sdk.gen";

interface SidebarSession {
  id: string;
  title: string;
  channelType: string;
  lastTime: string | null;
  status: string;
}

function mapDbSession(s: {
  id: string;
  title: string;
  channelType?: string | null;
  lastMessageAt?: string | null;
  updatedAt?: string;
  status?: string | null;
}): SidebarSession {
  return {
    id: s.id,
    title: s.title,
    channelType: s.channelType ?? "web",
    lastTime: s.lastMessageAt ?? s.updatedAt ?? null,
    status: s.status ?? "",
  };
}

type Platform =
  | "slack"
  | "discord"
  | "whatsapp"
  | "telegram"
  | "feishu"
  | "openclaw-weixin"
  | "web";

const PLATFORM_LABELS: Record<Platform, string> = {
  discord: "Discord",
  slack: "Slack",
  feishu: "Feishu",
  "openclaw-weixin": "WeChat",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  web: "Web",
};

function SidebarPlatformIcon({ platform }: { platform: string }) {
  return (
    <span className="flex justify-center items-center w-7 h-7 rounded-xl border border-border bg-surface-1 shrink-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <PlatformIcon platform={platform} size={15} />
    </span>
  );
}

function getPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform as Platform] ?? "Web";
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
  const { t } = useTranslation();
  return (
    <div className="flex flex-col justify-center items-center h-full px-8">
      <div className="max-w-md text-center">
        <div className="flex justify-center items-center mx-auto mb-6 w-16 h-16 rounded-2xl bg-accent/10">
          <MessageSquare size={28} className="text-accent" />
        </div>
        <h2 className="mb-2 text-xl font-bold text-text-primary">
          {t("layout.empty.title")}
        </h2>
        <p className="mb-6 text-sm leading-relaxed text-text-muted">
          {t("layout.empty.description")}
        </p>
        <div className="flex flex-col gap-3 items-center">
          <button
            type="button"
            onClick={onGoConfig}
            className="flex gap-2 items-center px-6 py-2.5 text-sm font-medium text-white rounded-lg transition-colors bg-accent hover:bg-accent-hover"
          >
            <Settings size={14} /> {t("layout.empty.setupBot")}
          </button>
          <div className="flex gap-4 mt-2">
            {[
              { step: "1", text: t("layout.empty.step1") },
              { step: "2", text: t("layout.empty.step2") },
              { step: "3", text: t("layout.empty.step3") },
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

function LanguageToggle({ collapsed }: { collapsed: boolean }) {
  const { locale, setLocale } = useLocale();
  const nextLocale: Locale = locale === "en" ? "zh" : "en";
  const label = locale === "en" ? "中文" : "EN";

  return (
    <div className={cn(collapsed ? "px-2" : "px-3", "pb-1")}>
      <button
        type="button"
        onClick={() => setLocale(nextLocale)}
        title={locale === "en" ? "切换到中文" : "Switch to English"}
        className={cn(
          "flex items-center gap-2 w-full rounded-lg text-[12px] font-medium text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors cursor-pointer",
          collapsed ? "justify-center p-2" : "px-3 py-2",
        )}
      >
        <Globe size={14} />
        {!collapsed && label}
      </button>
    </div>
  );
}

const SETUP_COMPLETE_KEY = "nexu_setup_complete";
const GITHUB_URL = "https://github.com/nexu-io/nexu";

const GitHubIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <title>GitHub</title>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

interface UpdateFloatCardProps {
  phase: ReturnType<typeof useAutoUpdate>["phase"];
  version: string | null;
  percent: number;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  t: (key: string, options?: Record<string, string>) => string;
  desktopOffsetLeft: number;
  desktopOffsetBottom: number;
  width: number;
}

function UpdateFloatCard({
  phase,
  version,
  percent,
  onDownload,
  onInstall,
  onDismiss,
  t,
  desktopOffsetLeft,
  desktopOffsetBottom,
  width,
}: UpdateFloatCardProps) {
  const updating = phase === "downloading";
  const downloadProgress = Math.round(percent);

  if (phase !== "available" && phase !== "downloading" && phase !== "ready") {
    return null;
  }

  return (
    <div
      className="fixed z-50 rounded-[14px] border border-border bg-surface-0/88 px-3.5 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.16)] backdrop-blur-md animate-float"
      style={
        {
          left: desktopOffsetLeft,
          bottom: desktopOffsetBottom,
          width,
          WebkitAppRegion: "no-drag",
        } as React.CSSProperties
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="relative mt-0.5 flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-success)] opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-success)]" />
            </span>
            <span className="text-[12px] font-medium text-text-primary">
              {updating
                ? t("layout.update.downloading")
                : phase === "ready"
                  ? t("layout.update.readyToInstall")
                  : t("layout.update.available", {
                      version: version ?? "",
                    })}
            </span>
          </div>
        </div>
        {!updating && phase !== "ready" && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-text-muted hover:text-text-primary transition-colors -mr-1"
          >
            <X size={12} />
          </button>
        )}
      </div>
      {updating && (
        <div className="flex items-center justify-between mt-3 mb-1">
          <span className="text-[10px] tabular-nums text-text-muted">
            {downloadProgress}%
          </span>
        </div>
      )}
      {updating ? (
        <div>
          <div className="h-[6px] w-full rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--color-brand-primary)] transition-all duration-300 ease-out"
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
        </div>
      ) : phase === "ready" ? (
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={onInstall}
            className="rounded-[6px] px-2.5 py-1 text-[11px] font-medium bg-[var(--color-accent)] text-white hover:opacity-85 transition-opacity"
          >
            {t("layout.update.install")}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={onDownload}
            className="rounded-[6px] px-2.5 py-1 text-[11px] font-medium bg-[var(--color-accent)] text-white hover:opacity-85 transition-opacity"
          >
            {t("layout.update.download")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-[6px] px-2 py-1 text-[11px] font-medium text-text-muted hover:text-text-primary transition-colors"
          >
            {t("layout.update.later")}
          </button>
        </div>
      )}
    </div>
  );
}

export function WorkspaceLayout() {
  if (localStorage.getItem(SETUP_COMPLETE_KEY) !== "1") {
    return <Navigate to="/" replace />;
  }

  return <WorkspaceLayoutInner />;
}

function WorkspaceLayoutInner() {
  const { t } = useTranslation();
  const { locale, setLocale } = useLocale();
  const isDesktopClient = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Electron"),
    [],
  );
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showHelpMenu, setShowHelpMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const update = useAutoUpdate();
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const hasUpdate =
    update.phase === "available" ||
    update.phase === "downloading" ||
    update.phase === "ready";
  const SIDEBAR_MIN = 160;
  const SIDEBAR_MAX = 320;
  const SIDEBAR_DEFAULT = 192;
  const MAIN_MIN = 480;
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("nexu_sidebar_width");
    return saved
      ? Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(saved)))
      : SIDEBAR_DEFAULT;
  });
  const isResizing = useRef(false);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startW = sidebarWidth;

      const onMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const containerWidth = window.innerWidth;
        const newW = Math.max(
          SIDEBAR_MIN,
          Math.min(SIDEBAR_MAX, startW + (ev.clientX - startX)),
        );
        if (containerWidth - newW >= MAIN_MIN) {
          setSidebarWidth(newW);
        }
      };

      const onUp = () => {
        isResizing.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setSidebarWidth((w) => {
          localStorage.setItem("nexu_sidebar_width", String(w));
          return w;
        });
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  const logoutRef = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const { data: skillsData } = useCommunitySkills();
  const installedSkillsCount = skillsData?.installedSkills?.length ?? 0;

  useEffect(() => {
    if (!isDesktopClient) {
      return;
    }

    const root = document.getElementById("root");
    const previousHtmlBackground =
      document.documentElement.style.backgroundColor;
    const previousBodyBackground = document.body.style.backgroundColor;
    const previousRootBackground = root?.style.backgroundColor ?? "";
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
    if (root) {
      root.style.backgroundColor = "transparent";
    }

    return () => {
      document.documentElement.style.backgroundColor = previousHtmlBackground;
      document.body.style.backgroundColor = previousBodyBackground;
      if (root) {
        root.style.backgroundColor = previousRootBackground;
      }
    };
  }, [isDesktopClient]);

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
    if (!showHelpMenu) return;
    const handler = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setShowHelpMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHelpMenu]);

  useEffect(() => {
    if (!showLangMenu) return;
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setShowLangMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLangMenu]);

  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [mobileDrawerOpen]);

  const { data: sessionsData } = useQuery({
    queryKey: ["sidebar-sessions"],
    queryFn: async (): Promise<SidebarSession[]> => {
      const { data } = await getApiV1Sessions({ query: { limit: 100 } });
      return (data?.sessions ?? []).map(mapDbSession);
    },
    refetchInterval: 10_000,
  });
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await getApiV1Me();
      return data;
    },
  });

  const sessions = sessionsData ?? [];

  const sessionMatch = location.pathname.match(/\/workspace\/sessions\/(.+)/);
  const selectedSessionId = sessionMatch?.[1] ?? null;
  const isHomePage =
    location.pathname === "/workspace" ||
    location.pathname === "/workspace/home";
  const isSkillsPage = location.pathname.includes("/skills");
  const isModelsPage =
    location.pathname.includes("/models") ||
    location.pathname.includes("/settings");

  const handleLogout = async () => {
    setShowLogoutConfirm(false);
    track("workspace_logout_click");
    await authClient.signOut();
    window.location.href = "/";
  };

  const userEmail = me?.email ?? session?.user?.email ?? "";
  const userName = me?.name?.trim() || session?.user?.name || userEmail;
  const userImage = me?.image ?? session?.user?.image ?? null;
  const userInitial = (userName[0] ?? userEmail[0] ?? "U").toUpperCase();

  const showEmptyState =
    sessions.length === 0 &&
    !isHomePage &&
    !isSkillsPage &&
    !isModelsPage &&
    !selectedSessionId;

  const selectedSession = selectedSessionId
    ? sessions.find((s) => s.id === selectedSessionId)
    : null;
  const mobileTitle = isHomePage
    ? t("layout.mobile.home")
    : isSkillsPage
      ? t("layout.mobile.skills")
      : isModelsPage
        ? t("layout.mobile.settings")
        : selectedSession?.title || t("layout.mobile.conversations");
  const mobileSubtitle = isHomePage
    ? t("layout.mobile.homeSubtitle")
    : isSkillsPage
      ? t("layout.mobile.skillsSubtitle")
      : isModelsPage
        ? t("layout.mobile.settingsSubtitle")
        : selectedSession
          ? `${getPlatformLabel(selectedSession.channelType)} · ${formatTime(selectedSession.lastTime)}`
          : `${sessions.length} conversation${sessions.length === 1 ? "" : "s"}`;
  const desktopGlassTint = "rgba(255, 255, 255, 0.08)";
  const updateFloatWidth = Math.max(140, sidebarWidth - 20);
  const updateFloatLeft = 10;
  const updateFloatBottom = 52;

  return (
    <div className="flex h-screen relative">
      {isDesktopClient && hasUpdate && !updateDismissed && (
        <UpdateFloatCard
          phase={update.phase}
          version={update.version}
          percent={update.percent}
          onDownload={() => update.download()}
          onInstall={() => update.install()}
          onDismiss={() => setUpdateDismissed(true)}
          t={t}
          desktopOffsetLeft={updateFloatLeft}
          desktopOffsetBottom={updateFloatBottom}
          width={updateFloatWidth}
        />
      )}

      {/* Fixed sidebar toggle — next to traffic lights (desktop client only) */}
      {isDesktopClient && (
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="fixed top-[12px] left-[80px] p-1.5 rounded-md text-text-tertiary hover:text-text-primary hover:bg-black/5 transition-colors hidden md:flex items-center justify-center z-50"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title={
            collapsed ? t("layout.expandSidebar") : t("layout.collapseSidebar")
          }
        >
          {collapsed ? (
            <PanelLeftOpen size={16} />
          ) : (
            <PanelLeftClose size={16} />
          )}
        </button>
      )}

      {/* Desktop sidebar — transparent bg, no border (matches design-system) */}
      <div
        className={`hidden md:flex flex-col shrink-0 overflow-hidden ${collapsed ? "w-0" : ""}`}
        style={
          {
            ...(!collapsed ? { width: sidebarWidth } : {}),
            transition: isResizing.current ? "none" : "width 200ms",
            WebkitAppRegion: "drag",
            background: isDesktopClient ? desktopGlassTint : "transparent",
          } as React.CSSProperties
        }
      >
        {/* Traffic light clearance (desktop client) */}
        {isDesktopClient && <div className="h-14 shrink-0" />}

        {/* Header / Brand */}
        <div
          className={cn(
            "flex items-center justify-between px-3 pb-2 shrink-0",
            !isDesktopClient && "border-b border-border py-3 px-4 gap-2.5",
          )}
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {isDesktopClient ? (
            <>
              <img
                src="/brand/logo-black-1.svg"
                alt="Nexu"
                className="h-6 object-contain"
              />
              {hasUpdate && updateDismissed && (
                <button
                  type="button"
                  onClick={() => setUpdateDismissed(false)}
                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[var(--color-brand-primary)] text-white hover:opacity-85 transition-opacity"
                >
                  {t("layout.update.badge")}
                </button>
              )}
            </>
          ) : (
            <>
              <BrandMark className="w-7 h-7 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-text-primary whitespace-nowrap">
                  Nexu <span className="text-[11px]">🦞</span>
                </div>
                <div className="text-[10px] text-text-tertiary whitespace-nowrap">
                  {t("layout.brand")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="p-1.5 rounded-lg transition-colors text-text-muted hover:text-text-primary hover:bg-surface-3 shrink-0"
                title={t("layout.collapseSidebar")}
              >
                <PanelLeftClose size={14} />
              </button>
            </>
          )}
        </div>

        {/* Main nav + conversations */}
        <div
          className="flex-1 overflow-y-auto"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Nav items */}
          <div className="px-2 pt-3 pb-1">
            <Link
              to="/workspace/home"
              onClick={() => {
                track("workspace_home_click");
                track("workspace_sidebar_click", { target: "home" });
              }}
              className={cn(
                "nav-item flex items-center gap-2.5 w-full rounded-[var(--radius-6)] text-[13px] transition-colors cursor-pointer mt-0.5 px-3 py-2 whitespace-nowrap",
                isHomePage && "nav-item-active",
              )}
            >
              <Home size={16} className="shrink-0" />
              {t("layout.nav.home")}
            </Link>
            <Link
              to="/workspace/skills"
              onClick={() => {
                track("workspace_skills_click");
                track("workspace_sidebar_click", { target: "skills" });
              }}
              className={cn(
                "nav-item flex items-center gap-2.5 w-full rounded-[var(--radius-6)] text-[13px] transition-colors cursor-pointer mt-0.5 px-3 py-2 whitespace-nowrap",
                isSkillsPage && "nav-item-active",
              )}
            >
              <Sparkles size={16} className="shrink-0" />
              {t("layout.nav.skills")}
              {installedSkillsCount > 0 && (
                <span className="ml-auto text-[10px] text-text-tertiary font-normal">
                  {installedSkillsCount}
                </span>
              )}
            </Link>
            <Link
              to="/workspace/settings"
              onClick={() => {
                track("workspace_settings_click");
                track("workspace_sidebar_click", { target: "settings" });
              }}
              className={cn(
                "nav-item flex items-center gap-2.5 w-full rounded-[var(--radius-6)] text-[13px] transition-colors cursor-pointer mt-0.5 px-3 py-2 whitespace-nowrap",
                isModelsPage && "nav-item-active",
              )}
            >
              <Settings size={16} className="shrink-0" />
              {t("layout.nav.settings")}
            </Link>
          </div>

          {/* Conversations section */}
          <div className="px-2 pt-6">
            <div className="sidebar-section-label whitespace-nowrap">
              {t("layout.conversations")}
            </div>
            <div className="space-y-0.5">
              {sessions.map((s) => {
                const isActive = selectedSessionId === s.id;
                return (
                  <button
                    type="button"
                    key={s.id}
                    data-sidebar-session-row={s.id}
                    data-session-channel-type={s.channelType ?? "web"}
                    data-session-state={s.status || "idle"}
                    onClick={() => {
                      const channel = normalizeChannel(s.channelType);
                      track("workspace_channel_click", {
                        channel_type: s.channelType,
                      });
                      track("workspace_sidebar_click", {
                        target: "conversations",
                        ...(channel ? { channel } : {}),
                      });
                      navigate(`/workspace/sessions/${s.id}`);
                    }}
                    className={cn(
                      "group flex items-center gap-2.5 w-full rounded-[10px] transition-colors cursor-pointer px-3 py-2 text-left",
                      isActive && "nav-item-active",
                    )}
                  >
                    <SidebarPlatformIcon platform={s.channelType ?? "web"} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={cn(
                            "text-[12px] truncate whitespace-nowrap font-medium",
                            !isActive && "text-text-primary",
                          )}
                        >
                          {s.title}
                        </div>
                        {s.status === "active" && (
                          <span className="shrink-0 rounded-full bg-[var(--color-success-subtle)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--color-success)]">
                            Live
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-muted truncate whitespace-nowrap">
                        <span>{getPlatformLabel(s.channelType ?? "web")}</span>
                        <span className="text-border">·</span>
                        <span>{formatTime(s.lastTime)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {s.status === "active" && (
                        <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom action row */}
        <div
          className="px-3 pb-1.5 flex items-center justify-between gap-1 shrink-0"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="flex items-center gap-1">
            <div className="relative" ref={helpRef}>
              {showHelpMenu && (
                <div className="absolute z-20 bottom-full left-0 mb-2 w-44">
                  <div className="rounded-xl border bg-surface-1 border-border shadow-xl shadow-black/10 overflow-hidden">
                    <div className="p-1.5">
                      <a
                        href="https://docs.nexu.io/"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() =>
                          track("workspace_docs_click", { type: "doc" })
                        }
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-black/5 transition-all"
                      >
                        <BookOpen size={14} />
                        {t("layout.help.docs")}
                      </a>
                      <a
                        href="mailto:hi@nexu.ai"
                        onClick={() =>
                          track("workspace_docs_click", { type: "contact" })
                        }
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-black/5 transition-all"
                      >
                        <Mail size={14} />
                        {t("layout.help.contact")}
                      </a>
                    </div>
                    <div className="border-t border-border p-1.5">
                      <a
                        href="https://github.com/nexu-io/nexu/releases"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() =>
                          track("workspace_docs_click", { type: "changelog" })
                        }
                        className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[12px] font-medium text-text-secondary hover:text-text-primary hover:bg-black/5 transition-all"
                      >
                        <ScrollText size={14} />
                        {t("layout.help.changelog")}
                      </a>
                    </div>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  if (!showHelpMenu) {
                    track("workspace_help_menu_open");
                  }
                  setShowHelpMenu(!showHelpMenu);
                  setShowLangMenu(false);
                }}
                className={cn(
                  "w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer",
                  showHelpMenu
                    ? "text-text-primary bg-black/5"
                    : "text-text-secondary hover:text-text-primary hover:bg-black/5",
                )}
                title={t("layout.help.title")}
              >
                <CircleHelp size={16} />
              </button>
            </div>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                track("workspace_github_click", { source: "sidebar" })
              }
              className="w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-text-primary hover:bg-black/5 transition-colors"
              title="GitHub"
            >
              <GitHubIcon />
            </a>
          </div>

          <div className="relative" ref={langRef}>
            {showLangMenu && (
              <div className="absolute z-[60] bottom-full right-0 mb-2 w-28">
                <div className="rounded-xl border bg-surface-1 border-border shadow-xl shadow-black/10 overflow-hidden p-1.5">
                  {(
                    [
                      { value: "en", label: "English" },
                      { value: "zh", label: "中文" },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setLocale(option.value as Locale);
                        setShowLangMenu(false);
                      }}
                      className={cn(
                        "flex items-center justify-between gap-2 w-full px-3 py-2 rounded-lg text-[12px] font-medium transition-all",
                        locale === option.value
                          ? "bg-black/5 text-text-primary"
                          : "text-text-secondary hover:text-text-primary hover:bg-black/5",
                      )}
                    >
                      <span>{option.label}</span>
                      {locale === option.value && (
                        <span className="text-[10px] text-text-muted">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setShowLangMenu(!showLangMenu);
                setShowHelpMenu(false);
              }}
              className={cn(
                "h-7 inline-flex items-center gap-1.5 rounded-md px-2 text-[11px] font-medium transition-colors cursor-pointer",
                showLangMenu
                  ? "text-text-primary bg-black/5"
                  : "text-text-secondary hover:text-text-primary hover:bg-black/5",
              )}
              title={locale === "en" ? "Switch language" : "切换语言"}
            >
              <Globe size={14} />
              <span>{locale === "en" ? "EN" : "中文"}</span>
            </button>
          </div>
        </div>

        {/* Account — hidden in desktop client */}
        {!isDesktopClient && (
          <div className="relative shrink-0" ref={logoutRef}>
            {showLogoutConfirm && (
              <div className="absolute z-20 bottom-full left-1.5 right-1.5 mb-2">
                <div className="rounded-xl border bg-surface-1 border-border shadow-xl shadow-black/10 overflow-hidden">
                  <div className="px-3.5 py-3 border-b border-border">
                    <div className="text-[12px] font-medium text-text-primary truncate whitespace-nowrap">
                      {userEmail}
                    </div>
                  </div>
                  <div className="p-1.5">
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[12px] font-medium text-text-muted hover:text-red-500 hover:bg-red-500/5 transition-all cursor-pointer whitespace-nowrap"
                    >
                      <LogOut size={13} />
                      {t("layout.signOut")}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="border-t border-border px-2 py-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(!showLogoutConfirm)}
                className="flex gap-2.5 items-center w-full px-2 py-2 rounded-lg transition-all hover:bg-surface-3 cursor-pointer"
              >
                {userImage ? (
                  <img
                    src={userImage}
                    alt={userName}
                    className="w-7 h-7 rounded-md object-cover ring-1 ring-accent/10 shrink-0"
                  />
                ) : (
                  <div className="flex justify-center items-center w-7 h-7 rounded-md bg-gradient-to-br from-accent/20 to-accent/5 text-[10px] font-bold text-accent ring-1 ring-accent/10 shrink-0">
                    {userInitial}
                  </div>
                )}
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-[12px] text-text-primary truncate font-medium whitespace-nowrap">
                    {userName}
                  </div>
                  <div className="text-[10px] text-text-muted truncate whitespace-nowrap">
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
        )}
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
          <div className="absolute inset-y-0 left-0 w-[84%] max-w-[320px] sidebar-vibrancy border-r border-border shadow-xl">
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2.5 min-w-0">
                  <BrandMark className="w-7 h-7 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text-primary truncate">
                      Nexu <span className="text-[11px]">🦞</span>
                    </div>
                    <div className="text-[10px] text-text-tertiary">
                      {t("layout.brand")}
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
                      track("workspace_sidebar_click", { target: "home" });
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
                    {t("layout.nav.home")}
                  </Link>
                  <Link
                    to="/workspace/skills"
                    onClick={() => {
                      track("workspace_skills_click");
                      track("workspace_sidebar_click", { target: "skills" });
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
                      {t("layout.nav.skills")}
                    </span>
                  </Link>
                  <Link
                    to="/workspace/settings"
                    onClick={() => {
                      track("workspace_settings_click");
                      track("workspace_sidebar_click", { target: "settings" });
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
                    {t("layout.nav.settings")}
                  </Link>
                </div>

                {/* Conversations section */}
                <div className="px-3 pt-2 pb-3">
                  <div className="border-t border-border pt-2 mb-1.5" />
                  <div className="px-3 mb-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wider">
                    {t("layout.conversations")}
                  </div>
                  <div className="space-y-0.5">
                    {sessions.map((s) => {
                      const isActive = selectedSessionId === s.id;
                      return (
                        <button
                          type="button"
                          key={s.id}
                          data-sidebar-session-row={s.id}
                          data-session-channel-type={s.channelType ?? "web"}
                          data-session-state={s.status || "idle"}
                          onClick={() => {
                            const channel = normalizeChannel(s.channelType);
                            track("workspace_channel_click", {
                              channel_type: s.channelType,
                            });
                            track("workspace_sidebar_click", {
                              target: "conversations",
                              ...(channel ? { channel } : {}),
                            });
                            setMobileDrawerOpen(false);
                            navigate(`/workspace/sessions/${s.id}`);
                          }}
                          className={cn(
                            "flex items-center gap-2.5 w-full rounded-[10px] transition-colors cursor-pointer px-2.5 py-2 text-left",
                            isActive
                              ? "bg-accent/10 text-accent"
                              : "text-text-secondary hover:text-text-primary hover:bg-surface-3",
                          )}
                        >
                          <SidebarPlatformIcon platform={s.channelType} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="text-[13px] truncate font-medium">
                                {s.title}
                              </div>
                              {s.status === "active" && (
                                <span className="shrink-0 rounded-full bg-[var(--color-success-subtle)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--color-success)]">
                                  Live
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-muted truncate">
                              <span>
                                {getPlatformLabel(s.channelType ?? "web")}
                              </span>
                              <span className="text-border">·</span>
                              <span>{formatTime(s.lastTime)}</span>
                            </div>
                          </div>
                          {s.status === "active" ? (
                            <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-500" />
                          ) : (
                            <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-text-muted/30" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Language toggle (mobile) */}
              <div className="px-3 pb-1">
                <LanguageToggle collapsed={false} />
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
                          {t("layout.signOut")}
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

      {/* Resize handle */}
      {!collapsed && (
        <div
          onMouseDown={handleResizeStart}
          className="hidden md:block w-[3px] shrink-0 cursor-col-resize group relative z-10"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <div className="absolute inset-y-0 -left-[2px] -right-[2px]" />
        </div>
      )}

      {/* Main content — elevated surface with rounded left edge */}
      <div className="relative flex-1 min-w-0">
        {isDesktopClient && (
          <div
            className="absolute inset-y-0 left-0 w-4 pointer-events-none"
            style={{ background: desktopGlassTint }}
          />
        )}
        <div
          className={cn(
            "relative flex h-full min-w-0 flex-col bg-surface-1 rounded-l-[12px]",
          )}
        >
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
              <EmptyState onGoConfig={() => navigate("/workspace/settings")} />
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
