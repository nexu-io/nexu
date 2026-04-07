import { identify, track } from "@/lib/tracking";
import {
  ExternalLink,
  KeyRound,
  Loader2,
  MessageCircleMore,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { postApiV1ChannelsQqbotConnect } from "../../../lib/api/sdk.gen";

const QQBOT_LOGIN_URL = "https://q.qq.com/qqbot/openclaw/login.html";

export interface QqbotSetupViewProps {
  onConnected: () => void;
  onConnectedChannelCreated?: (channelId: string) => void;
  disabled?: boolean;
}

export function QqbotSetupView({
  onConnected,
  onConnectedChannelCreated,
  disabled,
}: QqbotSetupViewProps) {
  const { t } = useTranslation();
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const getTrimmedCredentials = () => {
    const trimmedAppId = appId.trim();
    const trimmedAppSecret = appSecret.trim();
    return {
      appId: trimmedAppId,
      appSecret: trimmedAppSecret,
    };
  };

  const handleConnect = async () => {
    const { appId: trimmedAppId, appSecret: trimmedAppSecret } =
      getTrimmedCredentials();
    if (!trimmedAppId || !trimmedAppSecret) {
      toast.error(t("qqbotSetup.credentialsRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await postApiV1ChannelsQqbotConnect({
        body: { appId: trimmedAppId, appSecret: trimmedAppSecret },
      });

      if (error || !data) {
        toast.error(error?.message ?? t("qqbotSetup.connectFailed"));
        return;
      }

      toast.success(t("qqbotSetup.connectSuccess"));
      track("channel_ready", {
        channel: "qqbot",
        channel_type: "qqbot_app",
      });
      identify({ channels_connected: 1 });
      if (data.id) {
        onConnectedChannelCreated?.(data.id);
      }
      onConnected();
      setAppId("");
      setAppSecret("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-5 rounded-xl border bg-surface-1 border-border">
      <div className="flex gap-3 items-start mb-5">
        <div className="flex justify-center items-center w-9 h-9 rounded-lg bg-sky-500/10 shrink-0">
          <MessageCircleMore size={18} className="text-sky-500" />
        </div>
        <div>
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t("qqbotSetup.title")}
          </h3>
          <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
            {t("qqbotSetup.desc")}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-surface-0 p-4">
          <div className="text-[12px] font-medium text-text-primary mb-2">
            {t("qqbotSetup.quickSetup")}
          </div>
          <ol className="space-y-1 text-[12px] text-text-muted list-decimal pl-4">
            <li>
              <a
                href={QQBOT_LOGIN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline underline-offset-2"
              >
                {t("qqbotSetup.step1")}
                <ExternalLink size={12} />
              </a>
            </li>
            <li>{t("qqbotSetup.step2")}</li>
            <li>{t("qqbotSetup.step3")}</li>
            <li>{t("qqbotSetup.step4")}</li>
          </ol>
        </div>

        <div>
          <label
            htmlFor="qqbot-app-id"
            className="block text-[12px] font-medium text-text-primary mb-2"
          >
            {t("qqbotSetup.appIdLabel")}
          </label>
          <div className="relative">
            <KeyRound
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              id="qqbot-app-id"
              type="text"
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
              placeholder={t("qqbotSetup.appIdPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-surface-0 px-10 py-2.5 text-[13px] text-text-primary outline-none transition-all focus:border-accent"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="qqbot-app-secret"
            className="block text-[12px] font-medium text-text-primary mb-2"
          >
            {t("qqbotSetup.appSecretLabel")}
          </label>
          <div className="relative">
            <KeyRound
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              id="qqbot-app-secret"
              type="password"
              value={appSecret}
              onChange={(event) => setAppSecret(event.target.value)}
              placeholder={t("qqbotSetup.appSecretPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-surface-0 px-10 py-2.5 text-[13px] text-text-primary outline-none transition-all focus:border-accent"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleConnect}
            disabled={disabled || submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-fg transition-all hover:bg-accent-hover disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <MessageCircleMore size={14} />
            )}
            {t("qqbotSetup.connect")}
          </button>
        </div>
      </div>
    </div>
  );
}
