import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthLayout } from "./layouts/auth-layout";
import { InviteGuardLayout } from "./layouts/invite-guard-layout";
import { WorkspaceLayout } from "./layouts/workspace-layout";
import { ChannelsPage } from "./pages/channels";
import { CommunitySkillDetailPage } from "./pages/community-skill-detail";
import { FeishuBindPage } from "./pages/feishu-bind";
import { HomePage } from "./pages/home";
import { IntegrationsPage } from "./pages/integrations";
import { ModelsPage } from "./pages/models";
import { OAuthCallbackPage } from "./pages/oauth-callback";
import { RewardsPage } from "./pages/rewards";
import { SessionsPage } from "./pages/sessions";
import { SkillsPage } from "./pages/skills";
import { SlackClaimPage } from "./pages/slack-claim";
import { SlackOAuthCallbackPage } from "./pages/slack-oauth-callback";
import { WelcomePage } from "./pages/welcome";

function DocumentTitleSync() {
  const location = useLocation();
  const { t } = useTranslation();

  useEffect(() => {
    const titleByPathname: Record<string, string> = {
      "/claim": t("title.claim"),
      "/workspace": t("title.home"),
      "/workspace/home": t("title.home"),
      "/workspace/integrations": t("title.integrations"),
      "/workspace/rewards": t("title.rewards"),
      "/workspace/skills": t("title.skills"),
      "/workspace/settings": t("title.settings"),
      "/workspace/models": t("title.settings"),
      "/feishu/bind": t("title.linkFeishu"),
    };

    if (location.pathname.startsWith("/workspace/oauth-callback")) {
      document.title = t("title.connecting");
      return;
    }

    document.title = titleByPathname[location.pathname] ?? t("title.default");
  }, [location.pathname, t]);

  return null;
}

export function App() {
  return (
    <>
      <DocumentTitleSync />
      <Routes>
        <Route path="/" element={<WelcomePage />} />
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
              <Route path="/workspace/rewards" element={<RewardsPage />} />
              <Route path="/workspace/settings" element={<ModelsPage />} />
              <Route path="/workspace/models" element={<ModelsPage />} />
              <Route path="/workspace/skills" element={<SkillsPage />} />
              <Route
                path="/workspace/skills/:slug"
                element={<CommunitySkillDetailPage />}
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
