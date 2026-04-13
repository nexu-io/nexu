import { syncDesktopCloudQueries } from "@/hooks/use-desktop-cloud-status";
import { authClient } from "@/lib/auth-client";
import { resetAnalytics } from "@/lib/tracking";
import type { QueryClient } from "@tanstack/react-query";
import { postApiInternalDesktopCloudDisconnect } from "../../lib/api/sdk.gen";

const SETUP_COMPLETE_KEY = "nexu_setup_complete";

type LogoutOptions = {
  queryClient?: QueryClient;
};

export async function logoutToWelcome({
  queryClient,
}: LogoutOptions = {}): Promise<void> {
  localStorage.removeItem(SETUP_COMPLETE_KEY);
  resetAnalytics();

  await postApiInternalDesktopCloudDisconnect().catch(() => {});

  if (queryClient) {
    await syncDesktopCloudQueries(queryClient).catch(() => {});
  }

  await authClient.signOut().catch(() => {});
  window.location.assign("/");
}
