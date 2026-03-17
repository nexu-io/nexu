import { identify, track } from "@/lib/tracking";
import { ExternalLink, Eye, EyeOff, FileText, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  postApiV1ChannelsDiscordConnect,
  postApiV1ChannelsFeishuConnect,
  postApiV1ChannelsSlackConnect,
} from "../../lib/api/sdk.gen";

type ChannelType = "feishu" | "slack" | "discord";

interface ChannelConnectModalProps {
  channelType: ChannelType;
  onClose: () => void;
  onConnected: () => void | Promise<void>;
}

const SlackIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" role="img">
    <title>Slack</title>
    <path
      d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
      fill="#E01E5A"
    />
    <path
      d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
      fill="#36C5F0"
    />
    <path
      d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
      fill="#2EB67D"
    />
    <path
      d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z"
      fill="#ECB22E"
    />
  </svg>
);

const DiscordIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#5865F2" role="img">
    <title>Discord</title>
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const CHANNEL_CONFIGS: Record<
  ChannelType,
  {
    name: string;
    icon: React.ReactNode;
    docUrl: string;
    fields: {
      id: string;
      label: string;
      placeholder: string;
      helpText: string;
    }[];
  }
> = {
  feishu: {
    name: "飞书 / Feishu",
    icon: (
      <img
        src="/feishu-logo.png"
        width={18}
        height={18}
        alt="飞书"
        style={{ objectFit: "contain" }}
      />
    ),
    docUrl: "https://docs.nexu.ai/channels/feishu",
    fields: [
      {
        id: "appId",
        label: "App ID",
        placeholder: "cli_xxxxxxxxxxxxxxxx",
        helpText: "从飞书开放平台 > 应用凭证页面获取",
      },
      {
        id: "appSecret",
        label: "App Secret",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        helpText: "从飞书开放平台 > 应用凭证页面获取",
      },
    ],
  },
  slack: {
    name: "Slack",
    icon: <SlackIcon />,
    docUrl: "https://docs.nexu.ai/channels/slack",
    fields: [
      {
        id: "botToken",
        label: "Bot User OAuth Token",
        placeholder: "xoxb-...",
        helpText: "从 Slack App 的 OAuth & Permissions 页面获取",
      },
      {
        id: "signingSecret",
        label: "Signing Secret",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        helpText: "从 Slack App 的 Basic Information 页面获取",
      },
    ],
  },
  discord: {
    name: "Discord",
    icon: <DiscordIcon />,
    docUrl: "https://docs.nexu.ai/channels/discord",
    fields: [
      {
        id: "botToken",
        label: "Bot Token",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        helpText: "从 Discord Developer Portal > Bot 页面获取",
      },
      {
        id: "appId",
        label: "Application ID",
        placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        helpText: "从 Discord Developer Portal > General Information 获取",
      },
    ],
  },
};

export function ChannelConnectModal({
  channelType,
  onClose,
  onConnected,
}: ChannelConnectModalProps) {
  const config = CHANNEL_CONFIGS[channelType];
  const [fieldValues, setFieldValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(config.fields.map((f) => [f.id, ""])),
  );
  const [showFields, setShowFields] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(config.fields.map((f) => [f.id, false])),
  );
  const [loading, setLoading] = useState(false);

  const allFilled = config.fields.every((f) => fieldValues[f.id]?.trim());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleFieldChange = (id: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [id]: value }));
  };

  const toggleShowField = (id: string) => {
    setShowFields((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSubmit = async () => {
    if (!allFilled || loading) return;
    setLoading(true);

    try {
      let error: { message?: string } | undefined;
      let response: Response | undefined;

      if (channelType === "feishu") {
        ({ error, response } = await postApiV1ChannelsFeishuConnect({
          body: {
            appId: fieldValues.appId ?? "",
            appSecret: fieldValues.appSecret ?? "",
          },
        }));
      } else if (channelType === "slack") {
        ({ error, response } = await postApiV1ChannelsSlackConnect({
          body: {
            botToken: fieldValues.botToken ?? "",
            signingSecret: fieldValues.signingSecret ?? "",
          },
        }));
      } else if (channelType === "discord") {
        ({ error, response } = await postApiV1ChannelsDiscordConnect({
          body: {
            botToken: fieldValues.botToken ?? "",
            appId: fieldValues.appId ?? "",
          },
        }));
      }

      if (error) {
        if (response?.status === 409) {
          toast.info("渠道已连接，正在刷新...");
        } else {
          toast.error(error.message ?? "连接失败");
          return;
        }
      } else {
        toast.success(`${config.name} 连接成功`);
        track("channel_ready", { channel: channelType });
        identify({ [`${channelType}_connected`]: true });
      }

      // Close modal immediately, then refresh list in the background
      onClose();
      Promise.resolve(onConnected()).catch(() => {});
    } catch {
      toast.error("连接失败，请重试");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss is supplementary to Escape key */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal panel */}
      {/* biome-ignore lint/a11y/useSemanticElements: custom modal without native <dialog> open/close */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md mx-4 rounded-2xl border border-border bg-surface-0 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center border border-border bg-surface-1">
              {config.icon}
            </div>
            <div>
              <div className="text-[14px] font-semibold text-text-primary">
                连接 {config.name}
              </div>
              <div className="text-[11px] text-text-muted">配置 Bot 凭证</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Credential fields */}
          {config.fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <label
                htmlFor={`field-${field.id}`}
                className="block text-[12px] font-medium text-text-secondary"
              >
                {field.label}
              </label>
              <div className="relative">
                <input
                  id={`field-${field.id}`}
                  type={showFields[field.id] ? "text" : "password"}
                  value={fieldValues[field.id]}
                  onChange={(e) => handleFieldChange(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  className="w-full px-3 py-2 pr-9 rounded-lg border border-border bg-surface-1 text-[13px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => toggleShowField(field.id)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                >
                  {showFields[field.id] ? (
                    <EyeOff size={14} />
                  ) : (
                    <Eye size={14} />
                  )}
                </button>
              </div>
              <p className="text-[11px] text-text-muted">{field.helpText}</p>
            </div>
          ))}

          {/* Doc link */}
          <a
            href={config.docUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[12px] text-accent hover:underline mt-1"
          >
            <FileText size={13} />
            查看 {config.name} 接入教程
            <ExternalLink size={12} />
          </a>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-text-secondary hover:bg-surface-2 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!allFilled || loading}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "连接中..." : "连接"}
          </button>
        </div>
      </div>
    </div>
  );
}
