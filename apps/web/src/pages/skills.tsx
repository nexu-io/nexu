import { ToolkitIcon } from "@/components/toolkit-icon";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bot,
  Calendar,
  Check,
  Code,
  Copy,
  DollarSign,
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
  UserSearch,
  Users,
  Video,
  Zap,
} from "lucide-react";
import type { ElementType } from "react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import "@/lib/api";
import { getApiV1Skills } from "../../lib/api/sdk.gen";

type Skill = NonNullable<
  Awaited<ReturnType<typeof getApiV1Skills>>["data"]
>["skills"][number];

type Tag = NonNullable<
  Awaited<ReturnType<typeof getApiV1Skills>>["data"]
>["tags"][number];

type TagFilter = "all" | Tag["id"];
type SourceFilter = "official" | "custom";

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

function SkillLucideIcon({ iconName }: { iconName: string }) {
  const Icon = ICON_MAP[iconName] ?? Sparkles;
  return (
    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
      <Icon size={16} className="text-accent" />
    </div>
  );
}

function SkillCard({ skill }: { skill: Skill }) {
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const handleCopyPrompt = () => {
    navigator.clipboard.writeText(skill.prompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  return (
    <Link
      to={`/workspace/skills/${skill.slug}`}
      className="block group rounded-xl border border-border bg-surface-1 p-4 hover:border-accent/35 hover:shadow-md hover:shadow-accent/5 transition-all"
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
          <SkillLucideIcon iconName={skill.iconName} />
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[13px] font-semibold text-text-primary truncate">
            {skill.name}
          </span>
          {skill.tools && skill.tools.length > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-medium shrink-0">
              OAuth
            </span>
          )}
          {skill.githubUrl && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 font-medium shrink-0">
              Open
            </span>
          )}
        </div>
      </div>
      <p className="text-[12px] text-text-muted leading-relaxed line-clamp-2 mb-3">
        {skill.description}
      </p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {skill.tools && skill.tools.length > 0 ? (
            skill.tools.map((t) => (
              <span
                key={t.slug}
                className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted font-medium"
              >
                {t.provider}
              </span>
            ))
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted font-medium">
              No auth needed
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleCopyPrompt();
          }}
          className={cn(
            "flex items-center gap-1 text-[11px] font-medium transition-all",
            copiedPrompt
              ? "text-emerald-600"
              : "text-text-muted opacity-0 group-hover:opacity-100",
          )}
        >
          {copiedPrompt ? (
            <>
              <Check size={10} /> Copied
            </>
          ) : (
            <>
              <Copy size={10} /> Try
            </>
          )}
        </button>
      </div>
    </Link>
  );
}

export function SkillsPage() {
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<TagFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("official");

  const { data, isLoading } = useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      const { data } = await getApiV1Skills();
      return data;
    },
  });

  const skills = data?.skills ?? [];
  const tags = data?.tags ?? [];

  const sourceFilteredSkills = useMemo(
    () => skills.filter((s) => s.source === sourceFilter),
    [skills, sourceFilter],
  );

  const customCount = skills.filter((s) => s.source === "custom").length;

  const tagTabsWithCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sourceFilteredSkills) {
      counts[s.tag] = (counts[s.tag] ?? 0) + 1;
    }
    return tags.map((t) => ({
      ...t,
      count: counts[t.id] ?? 0,
    }));
  }, [sourceFilteredSkills, tags]);

  const filtered = useMemo(() => {
    let list = sourceFilteredSkills;
    if (tagFilter !== "all") {
      list = list.filter((s) => s.tag === tagFilter);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q),
      );
    }
    return list;
  }, [sourceFilteredSkills, tagFilter, query]);

  const sourceTabs: { id: SourceFilter; label: string }[] = [
    { id: "official", label: "Official" },
    { id: "custom", label: "Custom" },
  ];

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
            <div className="text-[12px] text-text-muted">
              {skills.length} skills
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Search */}
        <div className="mb-4 relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills..."
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-border bg-surface-1 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
          />
        </div>

        {/* Source tabs (primary filter) */}
        <div className="flex items-center gap-0 border-b border-border/30 mb-3 overflow-x-auto no-scrollbar">
          {sourceTabs.map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => {
                setSourceFilter(tab.id);
                if (tab.id === "custom") setTagFilter("all");
              }}
              className={cn(
                "relative px-3 py-2 text-[13px] font-medium transition-colors shrink-0",
                sourceFilter === tab.id
                  ? "text-text-primary"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              {tab.label}
              {tab.id === "custom" && customCount > 0 && (
                <span
                  className={cn(
                    "ml-1 text-[11px] tabular-nums",
                    sourceFilter === tab.id
                      ? "text-text-secondary"
                      : "text-text-muted/50",
                  )}
                >
                  {customCount}
                </span>
              )}
              {sourceFilter === tab.id && (
                <div className="absolute bottom-0 left-3 right-3 h-[2px] bg-text-primary rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Tag filter (secondary, only for non-custom) */}
        {sourceFilter !== "custom" && (
          <div className="flex items-center gap-1 mb-6 overflow-x-auto no-scrollbar flex-wrap">
            <button
              type="button"
              onClick={() => setTagFilter("all")}
              className={cn(
                "px-2.5 py-1 rounded-md text-[12px] transition-colors shrink-0",
                tagFilter === "all"
                  ? "text-text-primary font-medium bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                  : "text-text-muted hover:text-text-secondary font-normal",
              )}
            >
              All
              <span
                className={cn(
                  "ml-1 text-[10px] tabular-nums",
                  tagFilter === "all"
                    ? "text-text-secondary"
                    : "text-text-muted/40",
                )}
              >
                {sourceFilteredSkills.length}
              </span>
            </button>
            {tagTabsWithCounts.map((tag) => (
              <button
                type="button"
                key={tag.id}
                onClick={() => setTagFilter(tag.id)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[12px] transition-colors shrink-0",
                  tagFilter === tag.id
                    ? "text-text-primary font-medium bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                    : "text-text-muted hover:text-text-secondary font-normal",
                )}
              >
                {tag.label}
                <span
                  className={cn(
                    "ml-1 text-[10px] tabular-nums",
                    tagFilter === tag.id
                      ? "text-text-secondary"
                      : "text-text-muted/40",
                  )}
                >
                  {tag.count}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 size={24} className="animate-spin text-text-muted" />
          </div>
        )}

        {/* Grid */}
        {!isLoading && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((skill) => (
              <SkillCard key={skill.slug} skill={skill} />
            ))}
          </div>
        )}

        {/* Empty */}
        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-16">
            <div className="flex justify-center items-center mx-auto mb-3 w-12 h-12 rounded-xl bg-accent/10">
              <Zap size={20} className="text-accent" />
            </div>
            <p className="text-[13px] text-text-muted">
              {query.trim()
                ? "No skills match your search"
                : "No skills available"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
