import { formatChannelConnectErrorMessage } from "@/lib/channel-connect-errors";
import { identify, track } from "@/lib/tracking";
import {
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  MessageSquare,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { postApiV1ChannelsDingtalkConnect } from "../../../lib/api/sdk.gen";

const DINGTALK_OPEN_PLATFORM_URL =
  "https://open-dev.dingtalk.com/?spm=ding_open_doc.document.0.0.4eb96384sA4J3a";
const DINGTALK_DOCS_URL = "https://docs.nexu.io/guide/channels/dingtalk";

export interface DingtalkSetupViewProps {
  onConnected: () => void;
  onConnectedChannelCreated?: (channelId: string) => void;
  disabled?: boolean;
}

export function DingtalkSetupView({
  onConnected,
  onConnectedChannelCreated,
  disabled,
}: DingtalkSetupViewProps) {
  const { t } = useTranslation();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const getTrimmedCredentials = () => ({
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
  });

  const handleConnect = async () => {
    const { clientId: trimmedClientId, clientSecret: trimmedClientSecret } =
      getTrimmedCredentials();
    if (!trimmedClientId || !trimmedClientSecret) {
      toast.error(t("dingtalkSetup.credentialsRequired"));
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await postApiV1ChannelsDingtalkConnect({
        body: {
          clientId: trimmedClientId,
          clientSecret: trimmedClientSecret,
        },
      });

      if (error || !data) {
        toast.error(
          formatChannelConnectErrorMessage(
            error,
            t("dingtalkSetup.connectFailed"),
          ),
        );
        return;
      }

      toast.success(t("dingtalkSetup.connectSuccess"));
      track("channel_ready", {
        channel: "dingtalk",
        channel_type: "dingtalk_bot",
      });
      identify({ channels_connected: 1 });
      if (data.id) {
        onConnectedChannelCreated?.(data.id);
      }
      onConnected();
      setClientId("");
      setClientSecret("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-5 rounded-xl border bg-surface-1 border-border">
      <div className="flex gap-3 items-start mb-5">
        <div className="flex justify-center items-center w-9 h-9 rounded-lg bg-neutral-900/8 shrink-0">
          <MessageSquare size={18} className="text-neutral-800" />
        </div>
        <div>
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t("dingtalkSetup.title")}
          </h3>
          <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
            {t("dingtalkSetup.desc")}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-surface-0 p-4">
          <div className="text-[12px] font-medium text-text-primary mb-2">
            {t("dingtalkSetup.quickSetup")}
          </div>
          <ol className="space-y-1 text-[12px] text-text-muted list-decimal pl-4">
            <li>
              <a
                href={DINGTALK_OPEN_PLATFORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline underline-offset-2"
              >
                {t("dingtalkSetup.step1")}
                <ExternalLink size={12} />
              </a>
            </li>
            <li>{t("dingtalkSetup.step2")}</li>
            <li>{t("dingtalkSetup.step3")}</li>
            <li>{t("dingtalkSetup.step4")}</li>
          </ol>
        </div>

        <div>
          <label
            htmlFor="dingtalk-client-id"
            className="block text-[12px] font-medium text-text-primary mb-2"
          >
            {t("dingtalkSetup.clientIdLabel")}
          </label>
          <div className="relative">
            <KeyRound
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              id="dingtalk-client-id"
              type="text"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder={t("dingtalkSetup.clientIdPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-surface-0 px-10 py-2.5 text-[13px] text-text-primary outline-none transition-all focus:border-accent"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="dingtalk-client-secret"
            className="block text-[12px] font-medium text-text-primary mb-2"
          >
            {t("dingtalkSetup.clientSecretLabel")}
          </label>
          <div className="relative">
            <KeyRound
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
            />
            <input
              id="dingtalk-client-secret"
              type="password"
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              placeholder={t("dingtalkSetup.clientSecretPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-surface-0 px-10 py-2.5 text-[13px] text-text-primary outline-none transition-all focus:border-accent"
            />
          </div>
        </div>

        <a
          href={DINGTALK_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[12px] text-accent hover:underline"
        >
          <FileText size={13} />
          {t("modal.viewDocs", { name: t("home.channel.dingtalk") })}
          <ExternalLink size={12} />
        </a>

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
              <MessageSquare size={14} />
            )}
            {t("dingtalkSetup.connect")}
          </button>
        </div>
      </div>
    </div>
  );
}
