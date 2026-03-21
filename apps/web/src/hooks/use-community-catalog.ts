import type { SkillhubCatalogData } from "@/types/desktop";
import "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getApiV1SkillhubCatalog,
  postApiV1SkillhubImport,
  postApiV1SkillhubInstall,
  postApiV1SkillhubRefresh,
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: DETAIL_QUERY_KEY }),
      ]);
      return result;
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
