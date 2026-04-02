import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { App } from "./app";
import "./lib/api";
import { LocaleProvider } from "./hooks/use-locale";
import { authClient } from "./lib/auth-client";
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
  });
}

function AnalyticsSessionSync() {
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (isPending) {
      return;
    }

    const user = session?.user;
    const userEmail = typeof user?.email === "string" ? user.email : null;
    const userName = typeof user?.name === "string" ? user.name : null;
    const userId =
      user && typeof user.id === "string" && user.id.length > 0
        ? user.id
        : null;

    if (!userId) {
      resetAnalytics();
      return;
    }

    setUserId(userId);

    identify({
      email: userEmail,
      name: userName,
    });
  }, [isPending, session]);

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
