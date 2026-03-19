import type { SkillhubCatalogData } from "@/types/desktop";
import "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getApiV1SkillhubCatalog,
  postApiV1SkillhubInstall,
  postApiV1SkillhubUninstall,
} from "../../lib/api/sdk.gen";

const CATALOG_QUERY_KEY = ["skillhub", "catalog"] as const;
const DETAIL_QUERY_KEY = ["skillhub", "detail"] as const;

export function useCommunitySkills(opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async (): Promise<SkillhubCatalogData> => {
      const { data, error } = await getApiV1SkillhubCatalog();
      if (error) throw new Error("Catalog fetch failed");
      return data as unknown as SkillhubCatalogData;
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: opts?.refetchInterval,
  });
}

export function useInstallSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slug: string) => {
      const { data, error } = await postApiV1SkillhubInstall({
        body: { slug },
      });
      if (error) throw new Error("Install request failed");
      const result = data as { ok: boolean; error?: string };
      if (!result.ok) {
        throw new Error(result.error ?? "Install failed");
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: DETAIL_QUERY_KEY });
    },
  });
}

export function useUninstallSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slug: string) => {
      const { data, error } = await postApiV1SkillhubUninstall({
        body: { slug },
      });
      if (error) throw new Error("Uninstall request failed");
      const result = data as { ok: boolean; error?: string };
      if (!result.ok) {
        throw new Error(result.error ?? "Uninstall failed");
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: DETAIL_QUERY_KEY });
    },
  });
}

export function useRefreshCatalog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return { ok: true, skillCount: 0 };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
    },
  });
}
