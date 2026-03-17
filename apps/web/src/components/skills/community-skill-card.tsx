import {
  useInstallSkill,
  useUninstallSkill,
} from "@/hooks/use-community-catalog";
import { cn } from "@/lib/utils";
import type { MinimalSkill } from "@/types/desktop";
import { Download, Loader2, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

function formatDownloads(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

export function CommunitySkillCard({
  skill,
  isInstalled,
}: {
  skill: MinimalSkill;
  isInstalled: boolean;
}) {
  const installMutation = useInstallSkill();
  const uninstallMutation = useUninstallSkill();
  const [pendingAction, setPendingAction] = useState<
    "install" | "uninstall" | null
  >(null);

  const isBusy = pendingAction !== null;

  async function handleInstall() {
    setPendingAction("install");
    try {
      await installMutation.mutateAsync(skill.slug);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleUninstall() {
    setPendingAction("uninstall");
    try {
      await uninstallMutation.mutateAsync(skill.slug);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <Link
      to={`/workspace/skills/${skill.slug}`}
      className="block rounded-xl border border-border bg-surface-1 p-4 hover:border-accent/35 hover:shadow-md hover:shadow-accent/5 transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <span className="text-[13px] font-semibold text-text-primary truncate block">
            {skill.name}
          </span>
          <span className="text-[11px] text-text-muted font-mono">
            {skill.slug}
          </span>
        </div>
        {isInstalled ? (
          <button
            type="button"
            disabled={isBusy}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleUninstall();
            }}
            className={cn(
              "shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
              isBusy
                ? "bg-surface-3 text-text-muted cursor-not-allowed"
                : "bg-red-500/10 text-red-500 hover:bg-red-500/20",
            )}
          >
            {pendingAction === "uninstall" ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Trash2 size={10} />
            )}
            {pendingAction === "uninstall" ? "Removing..." : "Uninstall"}
          </button>
        ) : (
          <button
            type="button"
            disabled={isBusy}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleInstall();
            }}
            className={cn(
              "shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
              isBusy
                ? "bg-surface-3 text-text-muted cursor-not-allowed"
                : "bg-accent/10 text-accent hover:bg-accent/20",
            )}
          >
            {pendingAction === "install" ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Download size={10} />
            )}
            {pendingAction === "install" ? "Installing..." : "Install"}
          </button>
        )}
      </div>

      <p className="text-[12px] text-text-muted leading-relaxed line-clamp-2 mb-3">
        {skill.description}
      </p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 overflow-hidden">
          {skill.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-text-muted font-medium truncate"
            >
              {tag}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-3 shrink-0 text-[11px] text-text-muted">
          <span className="flex items-center gap-0.5">
            <Download size={10} />
            {formatDownloads(skill.downloads)}
          </span>
          {skill.stars > 0 && (
            <span className="flex items-center gap-0.5">
              <Star size={10} />
              {formatDownloads(skill.stars)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
