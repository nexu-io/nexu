import { useQuery } from "@tanstack/react-query";
import { getApiV1BotQuota } from "../../lib/api/sdk.gen";

export const BOT_QUOTA_QUERY_KEY = ["bot-quota"] as const;

export function useBotQuota() {
  const { data, isLoading } = useQuery({
    queryKey: BOT_QUOTA_QUERY_KEY,
    queryFn: async () => {
      const { data } = await getApiV1BotQuota();
      return data;
    },
    staleTime: 30_000,
  });

  return {
    available: data?.available ?? true,
    resetsAt: data?.resetsAt ?? "",
    usingByok: data?.usingByok ?? false,
    byokAvailable: data?.byokAvailable ?? false,
    autoFallbackTriggered: data?.autoFallbackTriggered ?? false,
    isLoading,
  };
}
