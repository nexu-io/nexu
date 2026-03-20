import {
  useInstallSkill,
  useUninstallSkill,
} from "@/hooks/use-community-catalog";
import { useLocale } from "@/hooks/use-locale";
import "@/lib/api";
import { getTagLabel } from "@/lib/skill-translations";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Star,
  Trash2,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getApiV1SkillhubSkillsBySlug } from "../../lib/api/sdk.gen";

type SkillDetail = {
  slug: string;
  name: string;
  description: string;
  downloads: number;
  stars: number;
  tags: string[];
  version: string;
  updatedAt: string;
  homepage: string;
  installed: boolean;
  skillContent: string | null;
  files: string[];
};

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

type MdBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; text: string }
  | { type: "hr" };

function parseMdBlocks(src: string): MdBlock[] {
  const body = src.replace(/^---[\s\S]*?---\s*/, "").trim();
  const lines = body.split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: (headingMatch[1] ?? "#").length,
        text: headingMatch[2] ?? "",
      });
      i++;
      continue;
    }

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").startsWith("```")) {
        codeLines.push(lines[i] ?? "");
        i++;
      }
      blocks.push({ type: "code", lang, lines: codeLines });
      i++; // skip closing ```
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    // Paragraph (collect consecutive non-empty, non-special lines)
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      if (
        cur.trim() === "" ||
        cur.startsWith("#") ||
        cur.startsWith("```") ||
        /^[-*]\s/.test(cur) ||
        /^\d+\.\s/.test(cur) ||
        /^(-{3,}|\*{3,}|_{3,})\s*$/.test(cur)
      ) {
        break;
      }
      paraLines.push(cur);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", text: paraLines.join(" ") });
    }
  }

  return blocks;
}

function renderInline(text: string): React.ReactNode[] {
  // Process inline markdown: bold, italic, inline code, links
  const parts: React.ReactNode[] = [];
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  match = regex.exec(text);
  while (match !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(
        <code
          key={match.index}
          className="px-1 py-0.5 rounded bg-surface-3 text-[12px] font-mono text-accent"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**")) {
      parts.push(
        <strong key={match.index} className="font-semibold text-text-primary">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("*")) {
      parts.push(
        <em key={match.index} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        parts.push(
          <a
            key={match.index}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {linkMatch[1]}
          </a>,
        );
      }
    }
    lastIndex = match.index + token.length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function SkillMdPreview({ content }: { content: string }) {
  const blocks = parseMdBlocks(content);

  return (
    <div className="prose-sm max-w-none space-y-3">
      {blocks.map((block, i) => {
        const key = `block-${i}`;
        switch (block.type) {
          case "heading": {
            const Tag = `h${Math.min(block.level + 1, 6)}` as "h2";
            const sizeClass =
              block.level === 1
                ? "text-[18px] mt-6 mb-2"
                : block.level === 2
                  ? "text-[15px] mt-5 mb-1.5"
                  : block.level === 3
                    ? "text-[14px] mt-4 mb-1"
                    : "text-[13px] mt-3 mb-1";
            return (
              <Tag
                key={key}
                className={`font-semibold text-text-primary ${sizeClass}`}
              >
                {renderInline(block.text)}
              </Tag>
            );
          }
          case "code":
            return (
              <div
                key={key}
                className="rounded-lg bg-[#1e1e2e] border border-border overflow-x-auto"
              >
                {block.lang && (
                  <div className="px-3 py-1.5 border-b border-white/5 text-[10px] text-text-muted font-mono uppercase tracking-wider">
                    {block.lang}
                  </div>
                )}
                <pre className="px-3 py-3 text-[12px] leading-relaxed font-mono text-[#cdd6f4] overflow-x-auto">
                  <code>{block.lines.join("\n")}</code>
                </pre>
              </div>
            );
          case "list": {
            const ListTag = block.ordered ? "ol" : "ul";
            return (
              <ListTag
                key={key}
                className={cn(
                  "pl-5 space-y-1 text-[13px] text-text-secondary leading-relaxed",
                  block.ordered ? "list-decimal" : "list-disc",
                )}
              >
                {block.items.map((item) => (
                  <li key={`${key}-${item.slice(0, 40)}`}>
                    {renderInline(item)}
                  </li>
                ))}
              </ListTag>
            );
          }
          case "hr":
            return <hr key={key} className="border-border my-4" />;
          case "paragraph":
            return (
              <p
                key={key}
                className="text-[13px] text-text-secondary leading-relaxed"
              >
                {renderInline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}

export function CommunitySkillDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t, locale } = useLocale();
  const installMutation = useInstallSkill();
  const uninstallMutation = useUninstallSkill();
  const [pendingAction, setPendingAction] = useState<
    "install" | "uninstall" | null
  >(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["skillhub", "detail", slug],
    queryFn: async (): Promise<SkillDetail> => {
      const { data, error } = await getApiV1SkillhubSkillsBySlug({
        path: { slug: slug as string },
      });
      if (error) throw new Error("Failed to load skill");
      return data as unknown as SkillDetail;
    },
    enabled: !!slug,
  });

  const isBusy = pendingAction !== null;

  async function handleInstall() {
    if (!slug) return;
    setPendingAction("install");
    try {
      await installMutation.mutateAsync(slug);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleUninstall() {
    if (!slug) return;
    setPendingAction("uninstall");
    try {
      await uninstallMutation.mutateAsync(slug);
    } finally {
      setPendingAction(null);
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-full bg-surface-0 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-full bg-surface-0">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <Link
            to="/workspace/skills"
            className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary transition-colors mb-6"
          >
            <ArrowLeft size={14} />
            {t("skillDetail.backToSkills")}
          </Link>
          <p className="text-[14px] text-text-muted">
            {t("skillDetail.notFound")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-surface-0">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Back link */}
        <Link
          to="/workspace/skills"
          className="inline-flex items-center gap-1.5 text-[13px] text-text-muted hover:text-text-primary transition-colors mb-6"
        >
          <ArrowLeft size={14} />
          {t("skillDetail.backToSkills")}
        </Link>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold text-text-primary mb-1">
              {data.name}
            </h1>
            <p className="text-[13px] text-text-muted font-mono mb-2">
              {data.slug}
              {data.version && (
                <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-surface-3">
                  v{data.version}
                </span>
              )}
            </p>
            <p className="text-[13px] text-text-secondary leading-relaxed">
              {data.description}
            </p>
          </div>

          {/* Install/Uninstall button */}
          {data.installed ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleUninstall()}
              className={cn(
                "shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors",
                isBusy
                  ? "bg-surface-3 text-text-muted cursor-not-allowed"
                  : "bg-red-500/10 text-red-500 hover:bg-red-500/20",
              )}
            >
              {pendingAction === "uninstall" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              {pendingAction === "uninstall"
                ? t("skillDetail.removing")
                : t("skillDetail.uninstall")}
            </button>
          ) : (
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void handleInstall()}
              className={cn(
                "shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors",
                isBusy
                  ? "bg-surface-3 text-text-muted cursor-not-allowed"
                  : "bg-accent text-white hover:bg-accent/90",
              )}
            >
              {pendingAction === "install" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              {pendingAction === "install"
                ? t("skillDetail.installing")
                : t("skillDetail.install")}
            </button>
          )}
        </div>

        {/* Stats + Tags */}
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-border">
          <span className="flex items-center gap-1 text-[12px] text-text-muted">
            <Download size={12} />
            {formatCount(data.downloads)} {t("skillDetail.downloads")}
          </span>
          {data.stars > 0 && (
            <span className="flex items-center gap-1 text-[12px] text-text-muted">
              <Star size={12} />
              {formatCount(data.stars)} {t("skillDetail.stars")}
            </span>
          )}
          {data.homepage && (
            <a
              href={data.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[12px] text-accent hover:underline"
            >
              <ExternalLink size={12} />
              {t("skillDetail.homepage")}
            </a>
          )}
          {data.tags.length > 0 && (
            <div className="flex items-center gap-1.5 ml-auto">
              {data.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted font-medium"
                >
                  {getTagLabel(tag, locale)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* SKILL.md content (only shown when installed) */}
        {data.skillContent && (
          <div className="mb-6">
            <SkillMdPreview content={data.skillContent} />
          </div>
        )}

        {/* Files list */}
        {data.files.length > 0 && (
          <div className="mb-6">
            <h3 className="text-[13px] font-semibold text-text-primary mb-2">
              {t("skillDetail.files")}
            </h3>
            <div className="rounded-lg bg-surface-1 border border-border p-3 space-y-1">
              {data.files.map((file) => (
                <div
                  key={file}
                  className="flex items-center gap-2 text-[12px] text-text-muted font-mono"
                >
                  <FileText size={12} />
                  {file}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
