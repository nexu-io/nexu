import { GitHubStarCta } from "@/components/github-star-cta";
import ImportSkillModal from "@/components/skills/import-skill-modal";
import {
  useCommunitySkills,
  useInstallSkill,
  useRefreshCatalog,
  useUninstallSkill,
} from "@/hooks/use-community-catalog";
import { useGitHubStars } from "@/hooks/use-github-stars";
import { useLocale } from "@/hooks/use-locale";
import { getTagLabel } from "@/lib/skill-translations";
import {
  type SkillSelection,
  type TopTab,
  type YoursSubTab,
  applySkillsViewStatePatch,
  createSkillDetailPath,
  createSkillDetailState,
  getUnavailableSkillDetailSlugs,
  parseSkillsViewState,
} from "@/lib/skills-view-state";
import { mapInstalledSkillSource, track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import type {
  InstalledSkill,
  MinimalSkill,
  SkillSource,
} from "@/types/desktop";
import { Compass, Loader2, Plus, Search, Settings2, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

const PAGE_SIZE = 50;
type UninstallableSkillSource = Exclude<SkillSource, "curated">;

function toUninstallSource(
  source: SkillSource | null | undefined,
): UninstallableSkillSource | undefined {
  return source && source !== "curated" ? source : undefined;
}

function getSkillType(tags: readonly string[]): string | null {
  const primaryTag = tags[0]?.trim();
  if (!primaryTag) {
    return null;
  }
  return primaryTag.toLowerCase();
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function SkillCard({
  skill,
  isInstalled,
  queueStatus,
  categoryLabel,
  skillSource,
  detailTo,
  isDetailAvailable,
  installation,
}: {
  skill: MinimalSkill;
  isInstalled: boolean;
  queueStatus?:
    | "queued"
    | "downloading"
    | "installing-deps"
    | "done"
    | "failed"
    | null;
  categoryLabel?: string;
  skillSource: "builtin" | "explore" | "custom";
  detailTo: string;
  isDetailAvailable: boolean;
  installation?: SkillSelection;
}) {
  const { t } = useTranslation();
  const installMutation = useInstallSkill();
  const uninstallMutation = useUninstallSkill();
  const [pendingAction, setPendingAction] = useState<
    "install" | "uninstall" | null
  >(null);

  const isQueueActive =
    queueStatus === "queued" ||
    queueStatus === "downloading" ||
    queueStatus === "installing-deps";
  const isMutating = pendingAction !== null;

  async function handleInstall() {
    setPendingAction("install");
    const skillType = getSkillType(skill.tags);
    try {
      await installMutation.mutateAsync(skill.slug);
      track("workspace_skill_install", {
        skill_name: skill.name,
        skill_type: skillType,
        skill_source: skillSource,
        success: true,
      });
      track("workspace_skill_enable", {
        name: skill.name,
        skill_source: skillSource,
      });
    } catch {
      track("workspace_skill_install", {
        skill_name: skill.name,
        skill_type: skillType,
        skill_source: skillSource,
        success: false,
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleUninstall() {
    setPendingAction("uninstall");
    try {
      await uninstallMutation.mutateAsync({
        slug: skill.slug,
        ...(toUninstallSource(installation?.source)
          ? { source: toUninstallSource(installation?.source) }
          : {}),
        ...(installation?.agentId ? { agentId: installation.agentId } : {}),
      });
      track("workspace_skill_uninstall", {
        skill_name: skill.name,
        skill_source: skillSource,
        success: true,
      });
      track("workspace_skill_disable", {
        name: skill.name,
        skill_source: skillSource,
      });
    } catch {
      track("workspace_skill_uninstall", {
        skill_name: skill.name,
        skill_source: skillSource,
        success: false,
      });
    } finally {
      setPendingAction(null);
    }
  }

  const cardContent = (
    <>
      {/* Header: Icon + Name + Category */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-[10px] bg-white border border-border flex items-center justify-center shrink-0">
          <Zap size={18} className="text-text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-text-heading truncate">
            {skill.name}
          </div>
          {categoryLabel && (
            <span className="text-[11px] text-text-muted">{categoryLabel}</span>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-[12px] text-text-tertiary leading-[1.5] line-clamp-2 mb-3">
        {skill.description}
      </p>

      {/* Footer */}
      <div
        className="mt-auto flex items-center justify-between"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <span />
        {isQueueActive || (isMutating && pendingAction === "install") ? (
          <span className="inline-flex items-center gap-1.5 rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium border border-border text-text-muted cursor-default">
            <Loader2 size={12} className="animate-spin" />
            {t("skills.installingAction")}
          </span>
        ) : isInstalled ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleUninstall();
            }}
            disabled={isMutating}
            className="text-[12px] font-medium text-text-muted hover:text-[var(--color-danger)] transition-colors"
          >
            {pendingAction === "uninstall"
              ? t("skills.uninstallingAction")
              : t("skills.uninstallAction")}
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleInstall();
            }}
            disabled={isMutating}
            className="rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium border border-border text-text-primary hover:bg-surface-2 hover:border-border-hover transition-colors"
          >
            {t("skills.installAction")}
          </button>
        )}
      </div>
    </>
  );

  if (!isDetailAvailable) {
    return (
      <div
        className={cn(
          "card flex flex-col p-4 cursor-default",
          isInstalled && !pendingAction ? "" : "",
        )}
      >
        {cardContent}
      </div>
    );
  }

  return (
    <Link
      to={detailTo}
      state={createSkillDetailState(installation)}
      draggable={false}
      className={cn(
        "card flex flex-col p-4",
        isInstalled && !pendingAction ? "" : "",
      )}
    >
      {cardContent}
    </Link>
  );
}

export function SkillsPage() {
  const { t } = useTranslation();
  const { stars } = useGitHubStars();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isDesktopClient = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Electron"),
    [],
  );
  const { locale } = useLocale();
  const { data, isLoading, isError } = useCommunitySkills();
  const refreshMutation = useRefreshCatalog();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const viewState = useMemo(
    () => parseSkillsViewState(searchParams),
    [searchParams],
  );
  const { topTab, yoursSubTab, activeTag, searchQuery } = viewState;
  const debouncedQuery = useDebounce(searchQuery, 150);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const pillScrollRef = useRef<HTMLDivElement>(null);
  const [showPillFade, setShowPillFade] = useState(false);
  const [showPillFadeLeft, setShowPillFadeLeft] = useState(false);

  const checkPillOverflow = useCallback(() => {
    const el = pillScrollRef.current;
    if (!el) {
      setShowPillFade(false);
      setShowPillFadeLeft(false);
      return;
    }
    const hasOverflow = el.scrollWidth > el.clientWidth;
    setShowPillFade(
      hasOverflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    );
    setShowPillFadeLeft(hasOverflow && el.scrollLeft > 2);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: topTab triggers re-check on tab switch
  useEffect(() => {
    checkPillOverflow();
    window.addEventListener("resize", checkPillOverflow);
    return () => window.removeEventListener("resize", checkPillOverflow);
  }, [checkPillOverflow, topTab]);

  const updateViewState = useCallback(
    (
      patch: Partial<{
        topTab: TopTab;
        yoursSubTab: YoursSubTab;
        activeTag: string | null;
        searchQuery: string;
      }>,
    ) => {
      setSearchParams((current) => applySkillsViewStatePatch(current, patch), {
        replace: true,
      });
    },
    [setSearchParams],
  );

  const allSkills = data?.skills ?? [];
  const installedSlugs = useMemo(
    () => new Set(data?.installedSlugs ?? []),
    [data?.installedSlugs],
  );
  const installedSkills: InstalledSkill[] = data?.installedSkills ?? [];

  // Queue items actively downloading that aren't already installed
  const activeQueueItems = useMemo(() => {
    const activeStatuses = new Set([
      "queued",
      "downloading",
      "installing-deps",
    ]);
    return (data?.queue ?? []).filter(
      (qi) => activeStatuses.has(qi.status) && !installedSlugs.has(qi.slug),
    );
  }, [data?.queue, installedSlugs]);
  const queueBySlug = useMemo(() => {
    const map = new Map<
      string,
      "queued" | "downloading" | "installing-deps" | "done" | "failed"
    >();
    for (const item of data?.queue ?? []) {
      map.set(item.slug, item.status);
    }
    return map;
  }, [data?.queue]);
  const queueSourceBySlug = useMemo(() => {
    const map = new Map<string, SkillSource>();
    for (const item of data?.queue ?? []) {
      map.set(item.slug, item.source);
    }
    return map;
  }, [data?.queue]);
  const unavailableDetailSlugs = useMemo(
    () => getUnavailableSkillDetailSlugs(allSkills, activeQueueItems),
    [allSkills, activeQueueItems],
  );

  // Show toast for "skill not found" errors
  const shownErrorSlugs = useRef(new Set<string>());
  useEffect(() => {
    for (const item of data?.queue ?? []) {
      if (
        item.status === "failed" &&
        item.errorCode === "skill_not_found" &&
        !shownErrorSlugs.current.has(item.slug)
      ) {
        shownErrorSlugs.current.add(item.slug);
        toast.error(t("skills.skillNotFound", { slug: item.slug }));
      }
    }
  }, [data?.queue, t]);

  // Compute top tags
  const topTags = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of allSkills) {
      for (const tag of s.tags) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag, count]) => ({ tag, count }));
  }, [allSkills]);

  // Build skill lists based on tabs — explore sorted by downloads desc
  const exploreSkills = [...allSkills]
    .filter((s) => !installedSlugs.has(s.slug))
    .sort((a, b) => b.downloads - a.downloads);
  const yourSkillsList = useMemo(() => {
    const installed = installedSkills.map((is) => {
      const catalogEntry = allSkills.find((s) => s.slug === is.slug);
      return (
        catalogEntry ?? {
          slug: is.slug,
          name: is.name || is.slug,
          description: is.description || "",
          downloads: 0,
          stars: 0,
          tags: [],
          version: "",
          updatedAt: "",
        }
      );
    });

    // Map active queue items to MinimalSkill shape with source for filtering
    const downloadingWithSource = activeQueueItems.map((qi) => {
      const catalogEntry = allSkills.find((s) => s.slug === qi.slug);
      return {
        skill: catalogEntry ?? {
          slug: qi.slug,
          name: qi.slug,
          description: "",
          downloads: 0,
          stars: 0,
          tags: [],
          version: "",
          updatedAt: "",
        },
        source: qi.source,
      };
    });

    if (yoursSubTab === "builtin") {
      const builtinSlugs = new Set(
        installedSkills
          .filter((is) => is.source === "curated" || is.source === "managed")
          .map((is) => is.slug),
      );
      const filteredDownloading = downloadingWithSource
        .filter((d) => d.source === "curated" || d.source === "managed")
        .map((d) => d.skill);
      return [
        ...filteredDownloading,
        ...installed.filter((s) => builtinSlugs.has(s.slug)),
      ];
    }
    if (yoursSubTab === "custom") {
      const customSlugs = new Set(
        installedSkills
          .filter(
            (is) =>
              is.source === "custom" ||
              is.source === "workspace" ||
              is.source === "user",
          )
          .map((is) => is.slug),
      );
      const filteredDownloading = downloadingWithSource
        .filter(
          (d) =>
            d.source === "custom" ||
            d.source === "workspace" ||
            d.source === "user",
        )
        .map((d) => d.skill);
      return [
        ...filteredDownloading,
        ...installed.filter((s) => customSlugs.has(s.slug)),
      ];
    }
    return [...downloadingWithSource.map((d) => d.skill), ...installed];
  }, [installedSkills, allSkills, yoursSubTab, activeQueueItems]);

  const baseSkills = topTab === "explore" ? exploreSkills : yourSkillsList;

  // Filter by tag and search
  const filteredSkills = useMemo(() => {
    let list = [...baseSkills];

    if (activeTag) {
      list = list.filter((s) => s.tags.includes(activeTag));
    }

    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      list = list.filter((s) =>
        [s.slug, s.name, s.description].join("\n").toLowerCase().includes(q),
      );
    }

    return list;
  }, [baseSkills, activeTag, debouncedQuery]);

  // Reset visible count when filters change — deps are intentional triggers
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps trigger reset on filter change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedQuery, activeTag, topTab, yoursSubTab]);

  // Intersection Observer for lazy loading
  const loadMore = useCallback(() => {
    setVisibleCount((prev) =>
      prev >= filteredSkills.length ? prev : prev + PAGE_SIZE,
    );
  }, [filteredSkills.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          loadMore();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  const visibleSkills = filteredSkills.slice(0, visibleCount);

  const installationBySlug = useMemo(() => {
    const map = new Map<string, SkillSelection>();
    for (const skill of installedSkills) {
      const existing = map.get(skill.slug);
      if (!existing) {
        map.set(skill.slug, {
          source: toUninstallSource(skill.source),
          agentId: skill.agentId,
        });
        continue;
      }

      if (existing.source === "workspace" && skill.source !== "workspace") {
        map.set(skill.slug, {
          source: toUninstallSource(skill.source),
          agentId: skill.agentId,
        });
      }
    }

    return map;
  }, [installedSkills]);

  // Category tabs for pills
  const categoryTabs = useMemo(() => {
    const base =
      topTab === "explore"
        ? [{ id: "all", label: t("skills.all"), count: exploreSkills.length }]
        : [{ id: "all", label: t("skills.all"), count: yourSkillsList.length }];

    const tagTabs = topTags
      .filter((t) => {
        const skills = topTab === "explore" ? exploreSkills : yourSkillsList;
        return skills.some((s) => s.tags.includes(t.tag));
      })
      .map((t) => {
        const skills = topTab === "explore" ? exploreSkills : yourSkillsList;
        return {
          id: t.tag,
          label: getTagLabel(t.tag, locale),
          count: skills.filter((s) => s.tags.includes(t.tag)).length,
        };
      });

    return [...base, ...tagTabs];
  }, [topTab, exploreSkills, yourSkillsList, topTags, locale, t]);

  // Yours sub-tab counts (include actively downloading items)
  const builtinCount =
    installedSkills.filter(
      (is) => is.source === "curated" || is.source === "managed",
    ).length +
    activeQueueItems.filter(
      (qi) => qi.source === "curated" || qi.source === "managed",
    ).length;
  const customCount =
    installedSkills.filter(
      (is) =>
        is.source === "custom" ||
        is.source === "workspace" ||
        is.source === "user",
    ).length +
    activeQueueItems.filter(
      (qi) =>
        qi.source === "custom" ||
        qi.source === "workspace" ||
        qi.source === "user",
    ).length;
  const totalYoursCount = installedSkills.length + activeQueueItems.length;

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-6 sm:pb-8">
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Loader2 size={24} className="animate-spin text-text-muted" />
            <p className="text-[13px] text-text-muted">
              {t("skills.loadingCatalog")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isError && allSkills.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 pb-6 sm:pb-8">
          <div className="text-center py-16">
            <div className="flex justify-center items-center mx-auto mb-3 w-12 h-12 rounded-xl bg-red-500/10">
              <Zap size={20} className="text-red-500" />
            </div>
            <p className="text-[13px] text-text-muted mb-2">
              {t("skills.catalogUnavailable")}
            </p>
            <button
              type="button"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="text-[12px] text-accent hover:underline"
            >
              {refreshMutation.isPending
                ? t("skills.retrying")
                : t("skills.tryAgain")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div
        className="max-w-4xl mx-auto px-4 sm:px-6 pb-6 sm:pb-8"
        style={{ paddingTop: isDesktopClient ? "2rem" : "0.5rem" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="heading-page">{t("skills.pageTitle")}</h1>
            <p className="heading-page-desc">{t("skills.pageSubtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <GitHubStarCta
              label={t("home.starGithub")}
              stars={stars}
              variant="button"
            />
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) =>
                  updateViewState({ searchQuery: e.target.value })
                }
                placeholder={t("skills.searchPlaceholder")}
                className="w-48 pl-9 pr-3 py-1.5 rounded-lg border border-border bg-surface-1 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-[var(--color-brand-primary)]/30 focus:ring-1 focus:ring-[var(--color-brand-primary)]/20 transition-colors"
              />
            </div>
            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-text-primary text-white text-[12px] font-medium hover:opacity-85 transition-opacity"
            >
              <Plus size={12} />
              {t("skills.import")}
            </button>
            <ImportSkillModal
              open={importModalOpen}
              onClose={() => setImportModalOpen(false)}
            />
          </div>
        </div>

        {/* Top-level tabs: Yours / Explore — segment control */}
        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-surface-2 mb-4">
          {(
            [
              {
                id: "yours" as const,
                label: t("skills.yours"),
                icon: Settings2,
              },
              {
                id: "explore" as const,
                label: t("skills.explore"),
                icon: Compass,
              },
            ] as const
          ).map((tab) => {
            const active = topTab === tab.id;
            const TabIcon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  updateViewState({
                    topTab: tab.id,
                    yoursSubTab: "all",
                    activeTag: tab.id === "yours" ? null : activeTag,
                  });
                }}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-medium transition-all",
                  active
                    ? "bg-white text-text-primary shadow-[var(--shadow-rest)]"
                    : "text-text-secondary hover:text-text-primary",
                )}
              >
                <TabIcon size={14} />
                {tab.label}
                {tab.id === "yours" && totalYoursCount > 0 && active && (
                  <span
                    className={cn(
                      "tabular-nums text-[12px]",
                      active ? "text-text-secondary" : "text-text-tertiary",
                    )}
                  >
                    {totalYoursCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Yours sub-tabs: All / Built-in / Custom */}
        {topTab === "yours" && (
          <div className="flex items-center gap-2 mb-3">
            {(
              [
                {
                  id: "all" as const,
                  label: t("skills.all"),
                  count: totalYoursCount,
                },
                {
                  id: "builtin" as const,
                  label: t("skills.builtin"),
                  count: builtinCount,
                },
                {
                  id: "custom" as const,
                  label: t("skills.custom"),
                  count: customCount,
                },
              ] as const
            ).map((tab) => {
              const active = yoursSubTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    updateViewState({
                      yoursSubTab: tab.id,
                      activeTag: null,
                    });
                  }}
                  className={cn(
                    "shrink-0 inline-flex items-center justify-center rounded-full h-7 px-3 text-[11px] leading-none font-medium transition-all",
                    active
                      ? "bg-[var(--color-accent)] text-white"
                      : "border border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-hover",
                  )}
                >
                  {tab.label}
                  <span
                    className={cn(
                      "ml-1 tabular-nums",
                      active ? "opacity-80" : "opacity-50",
                    )}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Category pill filters (Explore only) */}
        {topTab === "explore" && (
          <div className="relative mb-5">
            <div
              ref={pillScrollRef}
              onScroll={checkPillOverflow}
              className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5"
            >
              {categoryTabs.map((tab) => {
                const active =
                  (activeTag === null && tab.id === "all") ||
                  activeTag === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() =>
                      updateViewState({
                        activeTag: tab.id === "all" ? null : tab.id,
                      })
                    }
                    className={cn(
                      "shrink-0 inline-flex items-center justify-center rounded-full h-7 px-3 text-[11px] leading-none font-medium transition-all",
                      active
                        ? "bg-[var(--color-accent)] text-white"
                        : "border border-border bg-surface-1 text-text-secondary hover:text-text-primary hover:border-border-hover",
                    )}
                  >
                    {tab.label}
                    <span
                      className={cn(
                        "ml-1 tabular-nums",
                        active ? "opacity-80" : "opacity-50",
                      )}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
            {showPillFadeLeft && (
              <div className="pointer-events-none absolute top-0 left-0 bottom-0 w-12 bg-gradient-to-r from-[var(--color-surface-0)] to-transparent z-[1]" />
            )}
            {showPillFade && (
              <div className="pointer-events-none absolute top-0 right-0 bottom-0 w-12 bg-gradient-to-l from-[var(--color-surface-0)] to-transparent z-[1]" />
            )}
          </div>
        )}

        {/* ClawHub disclaimer */}
        <p className="text-[12px] text-text-tertiary mb-4 font-medium">
          {t("skills.clawhubDisclaimer")}{" "}
          <a
            href="https://github.com/nexu-io/nexu/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--color-accent)] hover:underline"
          >
            GitHub Issues
          </a>{" "}
          {t("skills.clawhubDisclaimerAfterLink")}
        </p>

        {
          <>
            {/* Skill Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {visibleSkills.map((skill) => {
                const firstTag = skill.tags[0];
                return (
                  <SkillCard
                    key={skill.slug}
                    skill={skill}
                    isInstalled={installedSlugs.has(skill.slug)}
                    queueStatus={queueBySlug.get(skill.slug)}
                    detailTo={createSkillDetailPath(
                      skill.slug,
                      location.search,
                      installationBySlug.get(skill.slug),
                    )}
                    installation={installationBySlug.get(skill.slug)}
                    isDetailAvailable={!unavailableDetailSlugs.has(skill.slug)}
                    skillSource={
                      topTab === "explore"
                        ? "explore"
                        : mapInstalledSkillSource(
                            installedSkills.find(
                              (item) => item.slug === skill.slug,
                            )?.source ??
                              queueSourceBySlug.get(skill.slug) ??
                              "managed",
                          )
                    }
                    categoryLabel={
                      firstTag ? getTagLabel(firstTag, locale) : undefined
                    }
                  />
                );
              })}
            </div>

            {/* Sentinel for infinite scroll */}
            {visibleCount < filteredSkills.length && (
              <div ref={sentinelRef} className="flex justify-center py-8">
                <Loader2 size={20} className="animate-spin text-text-muted" />
              </div>
            )}

            {/* Empty state */}
            {filteredSkills.length === 0 && (
              <div className="text-center py-12">
                <Search size={24} className="mx-auto text-text-muted mb-3" />
                <div className="text-[13px] text-text-muted">
                  {topTab === "yours" && !debouncedQuery.trim()
                    ? t("skills.noInstalledSkills")
                    : t("skills.noMatchingSkills")}
                </div>
              </div>
            )}
          </>
        }
      </div>
    </div>
  );
}
