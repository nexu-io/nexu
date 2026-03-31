import type { SkillSource, SkillhubCatalogData } from "@/types/desktop";
import "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getApiV1SkillhubCatalog,
  postApiV1SkillhubImport,
  postApiV1SkillhubInstall,
  postApiV1SkillhubRefresh,
  postApiV1SkillhubUninstall,
} from "../../lib/api/sdk.gen";

export type SkillUninstallInput = {
  slug: string;
  source?: Exclude<SkillSource, "curated">;
  agentId?: string | null;
};

const CATALOG_QUERY_KEY = ["skillhub", "catalog"] as const;
const DETAIL_QUERY_KEY = ["skillhub", "detail"] as const;

/** Active queue statuses that warrant faster polling. */
const ACTIVE_QUEUE_STATUSES = new Set([
  "queued",
  "downloading",
  "installing-deps",
]);

function hasActiveQueueItems(data: SkillhubCatalogData | undefined): boolean {
  if (!data?.queue?.length) return false;
  return data.queue.some((item) => ACTIVE_QUEUE_STATUSES.has(item.status));
}

export function useCommunitySkills(opts?: { refetchInterval?: number }) {
  const query = useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async (): Promise<SkillhubCatalogData> => {
      const { data, error } = await getApiV1SkillhubCatalog();
      if (error) throw new Error("Catalog fetch failed");
      return data as unknown as SkillhubCatalogData;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval:
      opts?.refetchInterval ??
      ((q) => {
        const data = q.state.data as SkillhubCatalogData | undefined;
        return hasActiveQueueItems(data) ? 3_000 : false;
      }),
  });

  return query;
}

export function useInstallSkill() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (slug: string) => {
      const { data, error } = await postApiV1SkillhubInstall({
        body: { slug },
      });
      if (error) throw new Error("Install request failed");
      const result = data as {
        ok: boolean;
        queued?: boolean;
        slug?: string;
        status?: string;
        position?: number;
        error?: string;
      };
      if (!result.ok) {
        throw new Error(result.error ?? "Install failed");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DETAIL_QUERY_KEY }),
      ]);
      if (result.queued) {
        toast.info(t("skills.installQueued"));
      }
      return result;
    },
  });
}

export function useUninstallSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ slug, source, agentId }: SkillUninstallInput) => {
      const { data, error } = await postApiV1SkillhubUninstall({
        body: {
          slug,
          ...(source ? { source } : {}),
          ...(agentId ? { agentId } : {}),
        },
      });
      if (error) throw new Error("Uninstall request failed");
      const result = data as { ok: boolean; error?: string };
      if (!result.ok) {
        throw new Error(result.error ?? "Uninstall failed");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DETAIL_QUERY_KEY }),
      ]);
      return result;
    },
  });
}

export function useImportSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const { data, error } = await postApiV1SkillhubImport({
        body: { file },
      });
      if (error) throw new Error("Import request failed");
      const result = data as { ok: boolean; slug?: string; error?: string };
      if (!result.ok) {
        throw new Error(result.error ?? "Import failed");
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DETAIL_QUERY_KEY }),
      ]);
      return result;
    },
  });
}

export function useRefreshCatalog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await postApiV1SkillhubRefresh();
      if (error) throw new Error("Refresh request failed");
      return data as { ok: boolean; skillCount: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
    },
  });
}
