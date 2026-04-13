import {
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import {
  getApiInternalDesktopCloudStatus,
  getApiInternalDesktopPreferences,
} from "../lib/api/sdk.gen";
import { App } from "./app";
import { DESKTOP_REWARDS_QUERY_KEY } from "./hooks/use-desktop-rewards";
import { LocaleProvider } from "./hooks/use-locale";
import "./lib/api";
import { getAnalyticsAppMetadata } from "./lib/analytics-app-metadata";
import { readAnalyticsPreferenceFromStorage } from "./lib/desktop-analytics-preference";
import {
  ANALYTICS_PREFERENCE_STORAGE_KEY,
  disableAnalytics,
  identifyAuthenticatedUser,
  initializeAnalytics,
  resetAnalytics,
} from "./lib/tracking";
import "./i18n";
import "./index.css";

const posthogApiKey = import.meta.env.VITE_POSTHOG_API_KEY;
const analyticsEnabledByPreference = readAnalyticsPreferenceFromStorage(
  typeof window === "undefined" ? null : window.localStorage,
);

if (posthogApiKey && analyticsEnabledByPreference === true) {
  const { appName, appVersion } = getAnalyticsAppMetadata();
  initializeAnalytics({
    apiKey: posthogApiKey,
    apiHost: import.meta.env.VITE_POSTHOG_HOST,
    environment: import.meta.env.MODE,
    appName,
    appVersion,
  });
}

function DesktopAnalyticsBootstrap() {
  useEffect(() => {
    let cancelled = false;

    const syncAnalyticsPreference = async () => {
      try {
        const { data } = await getApiInternalDesktopPreferences();
        if (cancelled || !data) {
          return;
        }

        try {
          localStorage.setItem(
            ANALYTICS_PREFERENCE_STORAGE_KEY,
            data.analyticsEnabled ? "1" : "0",
          );
        } catch {
          // Ignore local persistence failures.
        }

        if (!posthogApiKey) {
          return;
        }

        if (data.analyticsEnabled) {
          const { appName, appVersion } = getAnalyticsAppMetadata();
          initializeAnalytics({
            apiKey: posthogApiKey,
            apiHost: import.meta.env.VITE_POSTHOG_HOST,
            environment: import.meta.env.MODE,
            appName,
            appVersion,
          });
          return;
        }

        disableAnalytics();
      } catch {
        // Keep the existing analytics state if preferences cannot be loaded.
      }
    };

    void syncAnalyticsPreference();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

function AnalyticsSessionSync() {
  useEffect(() => {
    let cancelled = false;
    let lastObservedUserId: string | null = null;

    const syncAnalyticsIdentity = async () => {
      try {
        const { data } = await getApiInternalDesktopCloudStatus();
        if (cancelled) {
          return;
        }

        const userId =
          typeof data?.userId === "string" && data.userId.length > 0
            ? data.userId
            : null;
        const userEmail =
          typeof data?.userEmail === "string" ? data.userEmail : null;
        const userName =
          typeof data?.userName === "string" ? data.userName : null;

        if (!userId) {
          if (lastObservedUserId !== null) {
            resetAnalytics();
            lastObservedUserId = null;
          }
          return;
        }

        identifyAuthenticatedUser(userId, {
          email: userEmail,
          name: userName,
        });
        lastObservedUserId = userId;
      } catch {
        // Ignore transient fetch errors. Keep existing identity until a
        // successful status refresh says otherwise.
      }
    };

    void syncAnalyticsIdentity();
    const interval = window.setInterval(() => {
      void syncAnalyticsIdentity();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return null;
}

function DesktopRewardsSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const candidate = (window as Window & { nexuHost?: unknown }).nexuHost;
    if (!candidate || typeof candidate !== "object") {
      return;
    }

    const onDesktopCommand = Reflect.get(candidate, "onDesktopCommand");
    if (typeof onDesktopCommand !== "function") {
      return;
    }

    return onDesktopCommand.call(candidate, (command: { type?: string }) => {
      if (command.type === "desktop:rewards-updated") {
        void queryClient.invalidateQueries({
          queryKey: DESKTOP_REWARDS_QUERY_KEY,
        });
      }
    }) as (() => void) | undefined;
  }, [queryClient]);

  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <LocaleProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <DesktopAnalyticsBootstrap />
          <AnalyticsSessionSync />
          <DesktopRewardsSync />
          <App />
          <Toaster position="top-right" />
        </BrowserRouter>
      </QueryClientProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
