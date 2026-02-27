import { Navigate, Route, Routes } from "react-router-dom";
import { AuthLayout } from "./layouts/auth-layout";
import { WorkspaceLayout } from "./layouts/workspace-layout";
import { AuthPage } from "./pages/auth";
import { ChannelsPage } from "./pages/channels";
import { InvitePage } from "./pages/invite";
import { SessionsPage } from "./pages/sessions";
import { SlackOAuthCallbackPage } from "./pages/slack-oauth-callback";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/workspace" replace />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route element={<AuthLayout />}>
        <Route path="/invite" element={<InvitePage />} />
        <Route element={<WorkspaceLayout />}>
          <Route path="/workspace" element={<SessionsPage />} />
          <Route path="/workspace/sessions" element={<SessionsPage />} />
          <Route path="/workspace/sessions/:id" element={<SessionsPage />} />
          <Route path="/workspace/channels" element={<ChannelsPage />} />
          <Route
            path="/workspace/channels/slack/callback"
            element={<SlackOAuthCallbackPage />}
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
