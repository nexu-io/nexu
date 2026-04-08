import { useEffect, useMemo, useState } from "react";
import type { DesktopRuntimeConfig } from "../../shared/host";
import { ensureDesktopControllerReady } from "../lib/controller-ready";
import { getRuntimeConfig, startUnit } from "../lib/host-api";

export function useDesktopRuntimeConfig() {
  const [runtimeConfig, setRuntimeConfig] =
    useState<DesktopRuntimeConfig | null>(null);
  const [apiReady, setApiReady] = useState(false);

  useEffect(() => {
    void getRuntimeConfig()
      .then(setRuntimeConfig)
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (!runtimeConfig) return;
    if (apiReady) return;

    let cancelled = false;
    const readyUrl = new URL(
      "/api/internal/desktop/ready",
      runtimeConfig.urls.web,
    ).toString();

    void ensureDesktopControllerReady({
      readyUrl,
      startController: async () => {
        await startUnit("controller");
      },
    }).then((ready) => {
      if (!cancelled && ready) {
        setApiReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [runtimeConfig, apiReady]);

  const desktopWebUrl = useMemo(() => {
    if (!runtimeConfig || !apiReady) {
      return null;
    }

    return new URL("/workspace", runtimeConfig.urls.web).toString();
  }, [apiReady, runtimeConfig]);

  const desktopOpenClawUrl = useMemo(() => {
    if (!runtimeConfig) {
      return null;
    }

    return new URL(
      `/#token=${runtimeConfig.tokens.gateway}`,
      runtimeConfig.urls.openclawBase,
    ).toString();
  }, [runtimeConfig]);

  return {
    apiReady,
    desktopOpenClawUrl,
    desktopWebUrl,
    runtimeConfig,
  };
}
