import "@/lib/api";
import { cloudStatusResponseSchema } from "@nexu/shared";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { getApiInternalDesktopCloudStatus } from "../../lib/api/sdk.gen";
import { DESKTOP_REWARDS_QUERY_KEY } from "./use-desktop-rewards";

export const DESKTOP_CLOUD_STATUS_QUERY_KEY = ["desktop-cloud-status"] as const;

async function fetchDesktopCloudStatus() {
  const { data, error } = await getApiInternalDesktopCloudStatus();

  if (error || !data) {
    throw error ?? new Error("Failed to fetch desktop cloud status");
  }

  return cloudStatusResponseSchema.parse(data);
}

export function useDesktopCloudStatus() {
  return useQuery({
    queryKey: DESKTOP_CLOUD_STATUS_QUERY_KEY,
    queryFn: fetchDesktopCloudStatus,
  });
}

export async function syncDesktopCloudQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: DESKTOP_CLOUD_STATUS_QUERY_KEY,
    }),
    queryClient.invalidateQueries({
      queryKey: DESKTOP_REWARDS_QUERY_KEY,
    }),
    queryClient.invalidateQueries({
      queryKey: ["models"],
    }),
    queryClient.invalidateQueries({
      queryKey: ["desktop-default-model"],
    }),
    queryClient.invalidateQueries({
      queryKey: ["me"],
    }),
  ]);
}
