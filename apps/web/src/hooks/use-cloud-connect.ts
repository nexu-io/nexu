import { openExternalUrl } from "@/lib/desktop-links";
import type { AnalyticsAuthSource } from "@/lib/tracking";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  getApiInternalDesktopCloudStatus,
  postApiInternalDesktopCloudConnect,
  postApiInternalDesktopCloudDisconnect,
} from "../../lib/api/sdk.gen";
import { syncDesktopCloudQueries } from "./use-desktop-cloud-status";

interface UseCloudConnectOptions {
  cloudConnected: boolean;
  onPoll?: () => unknown;
  onConnected?: () => unknown;
}

export function useCloudConnect({
  cloudConnected,
  onPoll,
  onConnected,
}: UseCloudConnectOptions) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [cloudConnecting, setCloudConnecting] = useState(false);

  const handleCloudConnect = useCallback(
    async (source?: AnalyticsAuthSource) => {
      setCloudConnecting(true);
      try {
        const { data } = await postApiInternalDesktopCloudConnect({
          body: source ? { source } : undefined,
        });

        if (data?.error === "Connection attempt already in progress") {
          const statusResult = await getApiInternalDesktopCloudStatus().catch(
            () => null,
          );
          if (!statusResult?.data?.polling) {
            await postApiInternalDesktopCloudDisconnect().catch(
              () => undefined,
            );
            const retryResult = await postApiInternalDesktopCloudConnect({
              body: source ? { source } : undefined,
            });
            if (!retryResult.data?.error) {
              if (retryResult.data?.browserUrl) {
                await openExternalUrl(retryResult.data.browserUrl);
                toast.info(t("welcome.browserOpened"));
              }
              return;
            }
          }
          toast.info(t("welcome.cloudConnectInProgress"));
          return;
        }

        if (data?.error === "Already connected. Disconnect first.") {
          await syncDesktopCloudQueries(queryClient);
          setCloudConnecting(false);
          await onConnected?.();
          return;
        }

        if (data?.error) {
          setCloudConnecting(false);
          toast.error(data.error);
          return;
        }

        if (data?.browserUrl) {
          await openExternalUrl(data.browserUrl);
          toast.info(t("welcome.browserOpened"));
        }
      } catch {
        setCloudConnecting(false);
        toast.error(t("welcome.cloudConnectError"));
      }
    },
    [queryClient, t, onConnected],
  );

  useEffect(() => {
    if (!cloudConnecting || cloudConnected) {
      return;
    }

    const interval = window.setInterval(() => {
      void onPoll?.();
    }, 2000);
    return () => window.clearInterval(interval);
  }, [cloudConnecting, cloudConnected, onPoll]);

  useEffect(() => {
    if (!cloudConnecting || !cloudConnected) {
      return;
    }

    void syncDesktopCloudQueries(queryClient).finally(() => {
      setCloudConnecting(false);
    });
  }, [cloudConnected, cloudConnecting, queryClient]);

  return { cloudConnecting, handleCloudConnect };
}
