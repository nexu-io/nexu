import { formatChannelConnectErrorMessage } from "@/lib/channel-connect-errors";
import { identify, track } from "@/lib/tracking";
import { KeyRound, Loader2, MessageCircle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { postApiV1ChannelsTelegramConnect } from "../../../lib/api/sdk.gen";

export interface TelegramSetupViewProps {
  onConnected: () => void;
  disabled?: boolean;
}

export function TelegramSetupView({
  onConnected,
  disabled,
}: TelegramSetupViewProps) {
  const { t } = useTranslation();
  const [botToken, setBotToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleConnect = async () => {
    const trimmedToken = botToken.trim();
    if (!trimmedToken) {
      toast.error(t("telegramSetup.tokenRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await postApiV1ChannelsTelegramConnect({
        body: { botToken: trimmedToken },
      });

      if (error || !data) {
        toast.error(
          formatChannelConnectErrorMessage(
            error,
            t("telegramSetup.connectFailed"),
          ),
        );
        return;
      }

      toast.success(t("telegramSetup.connectSuccess"));
      track("channel_ready", {
        channel: "telegram",
        channel_type: "telegram_bot",
      });
      identify({ channels_connected: 1 });
      onConnected();
      setBotToken("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-5 rounded-xl border bg-surface-1 border-border">
      <div className="flex gap-3 items-start mb-5">
        <div className="flex justify-center items-center w-9 h-9 rounded-lg bg-sky-500/10 shrink-0">
          <MessageCircle size={18} className="text-sky-500" />
        </div>
        <div>
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t("telegramSetup.title")}
          </h3>
          <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
            {t("telegramSetup.desc")}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-surface-0 p-4">
          <div className="text-[12px] font-medium text-text-primary mb-2">
            {t("telegramSetup.quickSetup")}
          </div>
          <ol className="space-y-1 text-[12px] text-text-muted list-decimal pl-4">
            <li>{t("telegramSetup.step1")}</li>
            <li>{t("telegramSetup.step2")}</li>
            <li>{t("telegramSetup.step3")}</li>
            <li>{t("telegramSetup.step4")}</li>
          </ol>
        </div>

        <div>
          <label
            htmlFor="telegram-bot-token"
            className="block text-[12px] font-medium text-text-primary mb-2"
          >
            {t("telegramSetup.botTokenLabel")}
          </label>
          <div className="relative">
            <KeyRound
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              id="telegram-bot-token"
              type="password"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              placeholder={t("telegramSetup.botTokenPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-surface-0 px-10 py-2.5 text-[13px] text-text-primary outline-none transition-all focus:border-accent"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleConnect}
          disabled={disabled || submitting}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[13px] font-medium text-accent-fg transition-all hover:bg-accent-hover disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <MessageCircle size={14} />
          )}
          {t("telegramSetup.connect")}
        </button>
      </div>
    </div>
  );
}
