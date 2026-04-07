import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { getApiInternalDesktopCloudStatus } from "../lib/api/sdk.gen";
import webPackageJson from "../package.json";
import { App } from "./app";
import "./lib/api";
import { LocaleProvider } from "./hooks/use-locale";
import {
  identify,
  initializeAnalytics,
  resetAnalytics,
  setUserId,
} from "./lib/tracking";
import "./i18n";
import "./index.css";

const posthogApiKey = import.meta.env.VITE_POSTHOG_API_KEY;
if (posthogApiKey) {
  initializeAnalytics({
    apiKey: posthogApiKey,
    apiHost: import.meta.env.VITE_POSTHOG_HOST,
    environment: import.meta.env.MODE,
    appName: webPackageJson.name.replace("@nexu/", "nexu-"),
    appVersion: webPackageJson.version,
  });
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

        setUserId(userId);
        identify({
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
          <AnalyticsSessionSync />
          <App />
          <Toaster position="top-right" />
        </BrowserRouter>
      </QueryClientProvider>
    </LocaleProvider>
  </React.StrictMode>,
);
