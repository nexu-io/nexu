import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { identify, track } from "@/lib/tracking";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

export function SlackOAuthCallbackPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const success = searchParams.get("success") === "true";
  const error = searchParams.get("error");
  const teamName = searchParams.get("teamName");

  // Clear OAuth pending flag on both success and error paths
  useEffect(() => {
    sessionStorage.removeItem("slack_oauth_pending");
  }, []);

  useEffect(() => {
    if (success) {
      // Success path: show brief confirmation, then redirect
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      toast.success(`Slack workspace "${teamName}" connected!`);
      track("channel_ready", { channel: "slack", channel_type: "slack_auth" });
      identify({ channels_connected: 1 });

      const timer = setTimeout(() => {
        navigate("/workspace/channels", { replace: true });
      }, 2000);
      return () => clearTimeout(timer);
    }

    // Error path: immediately redirect back with error info in query params
    const errorMsg = error ?? "Authorization was not completed";
    const encodedError = encodeURIComponent(errorMsg);

    navigate(
      `/workspace/channels?slackManual=true&slackError=${encodedError}`,
      { replace: true },
    );
  }, [success, error, teamName, queryClient, navigate]);

  // Only the success path renders UI; error path navigates away immediately
  if (success) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle className="mx-auto h-12 w-12 text-emerald-500" />
            <CardTitle className="mt-4">{t("slackOAuth.connected")}</CardTitle>
            <CardDescription>
              {t("slackOAuth.connectedDesc", { teamName })}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="mb-4 text-sm text-muted-foreground">
              {t("slackOAuth.redirecting")}
            </p>
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Brief loading state while navigating away
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
