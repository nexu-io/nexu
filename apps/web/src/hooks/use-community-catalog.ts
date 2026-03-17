import type { SkillhubCatalogData } from "@/types/desktop";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getApiV1SkillhubCatalog,
  postApiV1SkillhubInstall,
  postApiV1SkillhubRefresh,
  postApiV1SkillhubUninstall,
} from "../../lib/api/sdk.gen";

const CATALOG_QUERY_KEY = ["skillhub", "catalog"] as const;
const DETAIL_QUERY_KEY = ["skillhub", "detail"] as const;

export function useCommunitySkills() {
  return useQuery({
    queryKey: CATALOG_QUERY_KEY,
    queryFn: async (): Promise<SkillhubCatalogData> => {
      const { data, error } = await getApiV1SkillhubCatalog();
      if (error) {
        throw new Error("Catalog fetch failed");
      }
      if (!data) {
        throw new Error("Catalog response missing");
      }
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useInstallSkill() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slug: string) => {
      const { data, error } = await postApiV1SkillhubInstall({
        body: { slug },
      });
      if (error) {
        throw new Error("Install request failed");
      }
      const result = data;
      if (!result) {
        throw new Error("Install response missing");
      }
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
      if (error) {
        throw new Error("Uninstall request failed");
      }
      const result = data;
      if (!result) {
        throw new Error("Uninstall response missing");
      }
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
      const { data, error } = await postApiV1SkillhubRefresh();
      if (error) {
        throw new Error("Catalog refresh request failed");
      }
      if (!data) {
        throw new Error("Catalog refresh response missing");
      }
      if (!data.ok) {
        throw new Error(data.error ?? "Catalog refresh failed");
      }
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_QUERY_KEY });
    },
  });
}
