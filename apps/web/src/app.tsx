import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthLayout } from "./layouts/auth-layout";
import { InviteGuardLayout } from "./layouts/invite-guard-layout";
import { WorkspaceLayout } from "./layouts/workspace-layout";
import { AuthPage } from "./pages/auth";
import { ChannelsPage } from "./pages/channels";
import { HomePage } from "./pages/home";
import { IntegrationsPage } from "./pages/integrations";
import { OAuthCallbackPage } from "./pages/oauth-callback";
import { OnboardingPage } from "./pages/onboarding";
import { SessionsPage } from "./pages/sessions";
import { SkillDetailPage } from "./pages/skill-detail";
import { ModelsPage } from "./pages/models";
import { SkillsPage } from "./pages/skills";
import { SlackOAuthCallbackPage } from "./pages/slack-oauth-callback";
import { WelcomePage } from "./pages/welcome";

function DocumentTitleSync() {
  const location = useLocation();

  useEffect(() => {
    const titleByPathname: Record<string, string> = {
      "/auth": "Sign In · Nexu",
      "/welcome": "Get Started · Nexu",
      "/onboarding": "Get Started · Nexu",
      "/workspace": "Home · Nexu",
      "/workspace/home": "Home · Nexu",
      "/workspace/integrations": "Integrations · Nexu",
      "/workspace/models": "Models · Nexu",
      "/workspace/skills": "Skills · Nexu",
    };

    if (location.pathname.startsWith("/workspace/oauth-callback")) {
      document.title = "Connecting · Nexu";
      return;
    }

    document.title = titleByPathname[location.pathname] ?? "Nexu";
  }, [location.pathname]);

  return null;
}

/**
 * Root redirect: if first-time user (no setup complete flag), go to welcome page.
 * Otherwise, go straight to workspace.
 */
function RootRedirect() {
  const setupComplete = localStorage.getItem("nexu_setup_complete") === "1";
  return <Navigate to={setupComplete ? "/workspace" : "/welcome"} replace />;
}

export function App() {
  return (
    <>
      <DocumentTitleSync />
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/welcome" element={<WelcomePage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route element={<AuthLayout />}>
          <Route element={<InviteGuardLayout />}>
            <Route path="/onboarding" element={<OnboardingPage />} />
            {/* OAuth callback — outside WorkspaceLayout for clean full-page card */}
            <Route
              path="/workspace/oauth-callback/:integrationId"
              element={<OAuthCallbackPage />}
            />
            <Route element={<WorkspaceLayout />}>
              <Route path="/workspace" element={<HomePage />} />
              <Route path="/workspace/home" element={<HomePage />} />
              <Route path="/workspace/sessions" element={<SessionsPage />} />
              <Route
                path="/workspace/sessions/:id"
                element={<SessionsPage />}
              />
              <Route path="/workspace/channels" element={<ChannelsPage />} />
              <Route
                path="/workspace/integrations"
                element={<IntegrationsPage />}
              />
              <Route path="/workspace/models" element={<ModelsPage />} />
              <Route path="/workspace/skills" element={<SkillsPage />} />
              <Route
                path="/workspace/skills/:slug"
                element={<SkillDetailPage />}
              />
              <Route
                path="/workspace/channels/slack/callback"
                element={<SlackOAuthCallbackPage />}
              />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
