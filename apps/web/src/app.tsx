import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthLayout } from "./layouts/auth-layout";
import { InviteGuardLayout } from "./layouts/invite-guard-layout";
import { WorkspaceLayout } from "./layouts/workspace-layout";
import { AuthPage } from "./pages/auth";
import { ChannelsPage } from "./pages/channels";
import { FeishuBindPage } from "./pages/feishu-bind";
import { HomePage } from "./pages/home";
import { IntegrationsPage } from "./pages/integrations";
import { ModelsPage } from "./pages/models";
import { OAuthCallbackPage } from "./pages/oauth-callback";
import { SessionsPage } from "./pages/sessions";
import { SkillDetailPage } from "./pages/skill-detail";
import { SkillsPage } from "./pages/skills";
import { SlackClaimPage } from "./pages/slack-claim";
import { SlackOAuthCallbackPage } from "./pages/slack-oauth-callback";
import { WelcomePage } from "./pages/welcome";

function DocumentTitleSync() {
  const location = useLocation();

  useEffect(() => {
    const titleByPathname: Record<string, string> = {
      "/auth": "Sign In · Nexu",
      "/claim": "Claim · Nexu",
      "/workspace": "Home · Nexu",
      "/workspace/home": "Home · Nexu",
      "/workspace/integrations": "Integrations · Nexu",
      "/workspace/skills": "Skills · Nexu",
      "/workspace/models": "Settings · Nexu",
      "/feishu/bind": "Link Feishu · Nexu",
    };

    if (location.pathname.startsWith("/workspace/oauth-callback")) {
      document.title = "Connecting · Nexu";
      return;
    }

    document.title = titleByPathname[location.pathname] ?? "Nexu";
  }, [location.pathname]);

  return null;
}

export function App() {
  return (
    <>
      <DocumentTitleSync />
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/claim" element={<SlackClaimPage />} />
        <Route path="/feishu/bind" element={<FeishuBindPage />} />
        <Route element={<AuthLayout />}>
          <Route element={<InviteGuardLayout />}>
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
