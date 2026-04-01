import { Switch } from "@/components/ui/switch";
import {
  useInstallSkill,
  useUninstallSkill,
} from "@/hooks/use-community-catalog";
import { getTagLabel } from "@/lib/skill-translations";
import type {
  InstalledSkill,
  MinimalSkill,
  QueueItemStatus,
} from "@/types/desktop";
import { Download, Star } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

function toUninstallSource(
  source: InstalledSkill["source"] | null | undefined,
): Exclude<InstalledSkill["source"], "curated"> | undefined {
  return source && source !== "curated" ? source : undefined;
}

function formatDownloads(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

export function CommunitySkillCard({
  skill,
  isInstalled,
  queueStatus,
  locale = "en",
  installation,
}: {
  skill: MinimalSkill;
  isInstalled: boolean;
  queueStatus?: QueueItemStatus | null;
  locale?: string;
  installation?: Pick<InstalledSkill, "source" | "agentId"> | null;
}) {
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

  async function handleToggle(checked: boolean) {
    if (checked) {
      // Turning ON = Install
      setPendingAction("install");
      try {
        await installMutation.mutateAsync(skill.slug);
      } finally {
        setPendingAction(null);
      }
    } else {
      // Turning OFF = Uninstall
      setPendingAction("uninstall");
      try {
        await uninstallMutation.mutateAsync({
          slug: skill.slug,
          ...(toUninstallSource(installation?.source)
            ? { source: toUninstallSource(installation?.source) }
            : {}),
          ...(installation?.agentId ? { agentId: installation.agentId } : {}),
        });
      } finally {
        setPendingAction(null);
      }
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
        <div
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
          <Switch
            size="xs"
            checked={isInstalled || isQueueActive}
            disabled={isMutating}
            loading={isMutating || isQueueActive}
            onCheckedChange={handleToggle}
          />
        </div>
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
              {getTagLabel(tag, locale)}
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
