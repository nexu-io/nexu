import * as amplitude from "@amplitude/unified";
import { Identify } from "@amplitude/unified";
import * as Sentry from "@sentry/electron/renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { getDesktopSentryBuildMetadata } from "../shared/sentry-build-metadata";
import { DesktopShell } from "./components/desktop-shell";
import "./runtime-page.css";

const amplitudeApiKey = import.meta.env.VITE_AMPLITUDE_API_KEY;
const rendererSentryDsn =
  typeof window === "undefined" ? null : window.nexuHost.bootstrap.sentryDsn;

let rendererSentryInitialized = false;

function initializeRendererSentry(dsn: string): void {
  if (rendererSentryInitialized) {
    return;
  }

  const sentryBuildMetadata = getDesktopSentryBuildMetadata(
    window.nexuHost.bootstrap.buildInfo,
  );

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: sentryBuildMetadata.release,
    ...(sentryBuildMetadata.dist ? { dist: sentryBuildMetadata.dist } : {}),
  });

  Sentry.setContext("build", sentryBuildMetadata.buildContext);

  rendererSentryInitialized = true;
}

if (rendererSentryDsn) {
  initializeRendererSentry(rendererSentryDsn);
}

if (amplitudeApiKey) {
  amplitude.initAll(amplitudeApiKey, {
    analytics: { autocapture: true },
    sessionReplay: { sampleRate: 1 },
  });
  const env = new Identify();
  env.set("environment", import.meta.env.MODE);
  amplitude.identify(env);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
function RootApp() {
  return <DesktopShell />;
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RootApp />
    </QueryClientProvider>
  </React.StrictMode>,
);
