import { identify, track } from "@/lib/tracking";
import { BriefcaseBusiness, KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { postApiV1ChannelsWecomConnect } from "../../../lib/api/sdk.gen";

export interface WecomSetupViewProps {
  onConnected: () => void;
  onConnectedChannelCreated?: (channelId: string) => void;
  disabled?: boolean;
}

export function WecomSetupView({
  onConnected,
  onConnectedChannelCreated,
  disabled,
}: WecomSetupViewProps) {
  const { t } = useTranslation();
  const [botId, setBotId] = useState("");
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const getTrimmedCredentials = () => {
    const trimmedBotId = botId.trim();
    const trimmedSecret = secret.trim();
    return {
      botId: trimmedBotId,
      secret: trimmedSecret,
    };
  };

  const handleConnect = async () => {
    const { botId: trimmedBotId, secret: trimmedSecret } =
      getTrimmedCredentials();
    if (!trimmedBotId || !trimmedSecret) {
      toast.error(t("wecomSetup.credentialsRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await postApiV1ChannelsWecomConnect({
        body: { botId: trimmedBotId, secret: trimmedSecret },
      });

      if (error || !data) {
        toast.error(error?.message ?? t("wecomSetup.connectFailed"));
        return;
      }

      toast.success(t("wecomSetup.connectSuccess"));
      track("channel_ready", {
        channel: "wecom",
        channel_type: "wecom_bot",
      });
      identify({ channels_connected: 1 });
      if (data.id) {
        onConnectedChannelCreated?.(data.id);
      }
      onConnected();
      setBotId("");
      setSecret("");
    } finally {
      setSubmitting(false);
    }
  };

  const wecomDeveloperCenterUrl =
    "https://work.weixin.qq.com/wework_admin/frame#/aiHelper/list?from=manage_tools";

  return (
    <div className="p-5 rounded-xl border bg-surface-1 border-border">
      <div className="flex gap-3 items-start mb-5">
        <div className="flex justify-center items-center w-9 h-9 rounded-lg bg-emerald-500/10 shrink-0">
          <BriefcaseBusiness size={18} className="text-emerald-600" />
        </div>
        <div>
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t("wecomSetup.title")}
          </h3>
          <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
            {t("wecomSetup.desc")}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-surface-0 p-4">
          <div className="text-[12px] font-medium text-text-primary mb-2">
            {t("wecomSetup.quickSetup")}
          </div>
          <ol className="space-y-1 text-[12px] text-text-muted list-decimal pl-4">
            <li>
              <a
                href={wecomDeveloperCenterUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline underline-offset-2 hover:text-accent-hover"
              >
                {t("wecomSetup.step1LinkLabel")}
              </a>
              {t("wecomSetup.step1Suffix")}
            </li>
            <li>{t("wecomSetup.step2")}</li>
            <li>{t("wecomSetup.step3")}</li>
            <li>{t("wecomSetup.step4")}</li>
          </ol>
        </div>

        <div>
          <label
            htmlFor="wecom-bot-id"
            className="block text-[12px] font-medium text-text-primary mb-2"
          >
            {t("wecomSetup.botIdLabel")}
          </label>
          <div className="relative">
            <KeyRound
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              id="wecom-bot-id"
              type="text"
              value={botId}
              onChange={(event) => setBotId(event.target.value)}
              placeholder={t("wecomSetup.botIdPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-surface-0 px-10 py-2.5 text-[13px] text-text-primary outline-none transition-all focus:border-accent"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="wecom-secret"
            className="block text-[12px] font-medium text-text-primary mb-2"
          >
            {t("wecomSetup.secretLabel")}
          </label>
          <div className="relative">
            <KeyRound
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              id="wecom-secret"
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={t("wecomSetup.secretPlaceholder")}
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
              <BriefcaseBusiness size={14} />
            )}
            {t("wecomSetup.connect")}
          </button>
        </div>
      </div>
    </div>
  );
}
