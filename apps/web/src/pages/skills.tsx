import { CommunitySkillCard } from "@/components/skills/community-skill-card";
import {
  useCommunitySkills,
  useRefreshCatalog,
} from "@/hooks/use-community-catalog";
import { cn } from "@/lib/utils";
import type { InstalledSkill, MinimalSkill } from "@/types/desktop";
import { Loader2, RefreshCw, Search, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CommunitySort = "downloads" | "stars" | "newest";
type DesktopTab = "installed" | "community";

const PAGE_SIZE = 50;

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

function formatTimeAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function CommunityTab() {
  const { data, isLoading, isError } = useCommunitySkills();
  const refreshMutation = useRefreshCatalog();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 150);
  const [sort, setSort] = useState<CommunitySort>("downloads");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const skills = data?.skills ?? [];
  const installedSlugs = new Set(data?.installedSlugs ?? []);
  const meta = data?.meta ?? null;

  const topTags = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of skills) {
      for (const tag of s.tags) {
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([tag]) => tag);
  }, [skills]);

  const filtered = useMemo(() => {
    let list = [...skills];

    if (activeTag) {
      list = list.filter((s) => s.tags.includes(activeTag));
    }

    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q),
      );
    }

    switch (sort) {
      case "downloads":
        list.sort((a, b) => b.downloads - a.downloads);
        break;
      case "stars":
        list.sort((a, b) => b.stars - a.stars);
        break;
      case "newest":
        list.sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
        break;
    }

    return list;
  }, [skills, activeTag, debouncedQuery, sort]);

  // Reset visible count when filters change — deps are intentional triggers
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps trigger reset on filter change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [debouncedQuery, sort, activeTag]);

  // Intersection Observer for lazy loading
  const loadMore = useCallback(() => {
    setVisibleCount((prev) =>
      prev >= filtered.length ? prev : prev + PAGE_SIZE,
    );
  }, [filtered.length]);

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

  const visibleSkills = filtered.slice(0, visibleCount);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2">
        <Loader2 size={24} className="animate-spin text-text-muted" />
        <p className="text-[13px] text-text-muted">
          Downloading skill catalog...
        </p>
      </div>
    );
  }

  if (isError && skills.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="flex justify-center items-center mx-auto mb-3 w-12 h-12 rounded-xl bg-red-500/10">
          <Zap size={20} className="text-red-500" />
        </div>
        <p className="text-[13px] text-text-muted mb-2">Catalog unavailable</p>
        <button
          type="button"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="text-[12px] text-accent hover:underline"
        >
          {refreshMutation.isPending ? "Retrying..." : "Try again"}
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Search + Sort + Freshness */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search community skills..."
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-surface-1 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as CommunitySort)}
          className="px-2.5 py-2.5 rounded-lg border border-border bg-surface-1 text-[12px] text-text-primary focus:outline-none focus:border-accent"
        >
          <option value="downloads">Downloads</option>
          <option value="stars">Stars</option>
          <option value="newest">Newest</option>
        </select>
        <button
          type="button"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="p-2.5 rounded-lg border border-border bg-surface-1 text-text-muted hover:text-text-primary transition-colors"
          title="Refresh catalog"
        >
          <RefreshCw
            size={14}
            className={refreshMutation.isPending ? "animate-spin" : ""}
          />
        </button>
      </div>

      {/* Freshness indicator */}
      {meta?.updatedAt && (
        <p className="text-[11px] text-text-muted mb-3">
          Last updated: {formatTimeAgo(meta.updatedAt)} &middot;{" "}
          {meta.skillCount.toLocaleString()} skills
        </p>
      )}

      {/* Tag chips */}
      {topTags.length > 0 && (
        <div className="flex items-center gap-1 mb-6 overflow-x-auto no-scrollbar flex-wrap">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={cn(
              "px-2.5 py-1 rounded-md text-[12px] transition-colors shrink-0",
              activeTag === null
                ? "text-text-primary font-medium bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                : "text-text-muted hover:text-text-secondary font-normal",
            )}
          >
            All
          </button>
          {topTags.map((tag) => (
            <button
              type="button"
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={cn(
                "px-2.5 py-1 rounded-md text-[12px] transition-colors shrink-0",
                activeTag === tag
                  ? "text-text-primary font-medium bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                  : "text-text-muted hover:text-text-secondary font-normal",
              )}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {visibleSkills.map((skill) => (
          <CommunitySkillCard
            key={skill.slug}
            skill={skill}
            isInstalled={installedSlugs.has(skill.slug)}
          />
        ))}
      </div>

      {/* Sentinel for infinite scroll */}
      {visibleCount < filtered.length && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          <Loader2 size={20} className="animate-spin text-text-muted" />
        </div>
      )}

      {/* Empty */}
      {filtered.length === 0 && (
        <div className="text-center py-16">
          <div className="flex justify-center items-center mx-auto mb-3 w-12 h-12 rounded-xl bg-accent/10">
            <Zap size={20} className="text-accent" />
          </div>
          <p className="text-[13px] text-text-muted">
            {debouncedQuery.trim()
              ? "No skills match your search"
              : "No community skills available"}
          </p>
        </div>
      )}
    </>
  );
}

const SOURCE_LABELS: Record<string, { label: string; description: string }> = {
  curated: {
    label: "Recommended",
    description: "Pre-installed skills recommended by Nexu",
  },
  managed: {
    label: "Installed",
    description: "Community skills you installed",
  },
};

const SOURCE_ORDER = ["curated", "managed"] as const;

function InstalledTab() {
  // Poll every 3s for up to 30s after mount to catch background curated installs.
  const [pollUntil] = useState(() => Date.now() + 30_000);
  const shouldPoll = Date.now() < pollUntil;
  const { data, isLoading } = useCommunitySkills({
    refetchInterval: shouldPoll ? 3_000 : undefined,
  });

  const installedSkills: InstalledSkill[] = data?.installedSkills ?? [];
  const allCatalogSkills = data?.skills ?? [];

  const grouped = useMemo(() => {
    const groups = new Map<string, InstalledSkill[]>();
    for (const skill of installedSkills) {
      const existing = groups.get(skill.source) ?? [];
      existing.push(skill);
      groups.set(skill.source, existing);
    }
    return groups;
  }, [installedSkills]);

  const catalogMap = useMemo(() => {
    const map = new Map<string, MinimalSkill>();
    for (const s of allCatalogSkills) {
      map.set(s.slug, s);
    }
    return map;
  }, [allCatalogSkills]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (installedSkills.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="flex justify-center items-center mx-auto mb-3 w-12 h-12 rounded-xl bg-accent/10">
          <Zap size={20} className="text-accent" />
        </div>
        <p className="text-[13px] text-text-muted">No skills installed</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {SOURCE_ORDER.map((source) => {
        const skills = grouped.get(source);
        if (!skills || skills.length === 0) return null;

        const meta = SOURCE_LABELS[source] ?? {
          label: source,
          description: "",
        };
        const canUninstall = true;

        return (
          <div key={source}>
            <div className="mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-[13px] font-semibold text-text-primary">
                  {meta.label}
                </h3>
                <span className="text-[11px] text-text-muted tabular-nums">
                  {skills.length}
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5">
                {meta.description}
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {skills.map((skill) => {
                const catalogEntry = catalogMap.get(skill.slug);
                const displaySkill: MinimalSkill = catalogEntry ?? {
                  slug: skill.slug,
                  name: skill.name || skill.slug,
                  description: skill.description || `${meta.label} skill`,
                  downloads: 0,
                  stars: 0,
                  tags: [],
                  version: "",
                  updatedAt: "",
                };
                return (
                  <CommunitySkillCard
                    key={skill.slug}
                    skill={displaySkill}
                    isInstalled={canUninstall}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DesktopSkillsContent() {
  const [desktopTab, setDesktopTab] = useState<DesktopTab>("community");
  const { data } = useCommunitySkills();
  const installedCount =
    data?.installedSkills?.length ?? data?.installedSlugs?.length ?? 0;

  const desktopTabs: { id: DesktopTab; label: string }[] = [
    { id: "community", label: "Community" },
    { id: "installed", label: "Installed" },
  ];

  return (
    <>
      {/* Desktop tabs */}
      <div className="flex items-center gap-0 border-b border-border/30 mb-4 overflow-x-auto no-scrollbar">
        {desktopTabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setDesktopTab(tab.id)}
            className={cn(
              "relative px-3 py-2 text-[13px] font-medium transition-colors shrink-0",
              desktopTab === tab.id
                ? "text-text-primary"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            {tab.label}
            {tab.id === "installed" && installedCount > 0 && (
              <span
                className={cn(
                  "ml-1 text-[11px] tabular-nums",
                  desktopTab === tab.id
                    ? "text-text-secondary"
                    : "text-text-muted/50",
                )}
              >
                {installedCount}
              </span>
            )}
            {desktopTab === tab.id && (
              <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-text-primary rounded-full" />
            )}
          </button>
        ))}
      </div>

      {desktopTab === "community" ? <CommunityTab /> : <InstalledTab />}
    </>
  );
}

export function SkillsPage() {
  return (
    <div className="min-h-full bg-surface-0">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 border-b border-border bg-surface-0/85 backdrop-blur-md">
        <div className="h-14 max-w-5xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Zap size={16} className="text-accent" />
            </div>
            <div className="text-[14px] font-semibold text-text-primary">
              Skills
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <DesktopSkillsContent />
      </div>
    </div>
  );
}
