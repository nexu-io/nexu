import { Input } from "@/components/ui/input";
import { identify, track } from "@/lib/tracking";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  Lock,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { postApiV1ChannelsFeishuConnect } from "../../../lib/api/sdk.gen";

const FEISHU_SETUP_STEP_KEYS = [
  "feishuSetup.stepCreateApp",
  "feishuSetup.stepPermissions",
  "feishuSetup.stepCredentials",
];

const FEISHU_PERMISSIONS_JSON = JSON.stringify(
  {
    scopes: {
      tenant: [
        "board:whiteboard:node:create",
        "board:whiteboard:node:delete",
        "board:whiteboard:node:read",
        "board:whiteboard:node:update",
        "calendar:calendar.acl:create",
        "calendar:calendar.acl:delete",
        "calendar:calendar.acl:read",
        "calendar:calendar.event:create",
        "calendar:calendar.event:delete",
        "calendar:calendar.event:read",
        "calendar:calendar.event:reply",
        "calendar:calendar.event:update",
        "calendar:calendar.free_busy:read",
        "calendar:calendar:create",
        "calendar:calendar:delete",
        "calendar:calendar:read",
        "calendar:calendar:subscribe",
        "calendar:calendar:update",
        "contact:contact.base:readonly",
        "contact:user.base:readonly",
        "docs:document.comment:create",
        "docs:document.comment:read",
        "docs:document.comment:update",
        "docs:document.comment:write_only",
        "docs:permission.member:create",
        "docx:document.block:convert",
        "docx:document:create",
        "docx:document:readonly",
        "docx:document:write_only",
        "drive:drive.metadata:readonly",
        "drive:drive.search:readonly",
        "drive:drive:version",
        "drive:drive:version:readonly",
        "im:chat.announcement:read",
        "im:chat.announcement:write_only",
        "im:chat.chat_pins:read",
        "im:chat.chat_pins:write_only",
        "im:chat.collab_plugins:read",
        "im:chat.collab_plugins:write_only",
        "im:chat.managers:write_only",
        "im:chat.members:bot_access",
        "im:chat.members:read",
        "im:chat.members:write_only",
        "im:chat.menu_tree:read",
        "im:chat.menu_tree:write_only",
        "im:chat.moderation:read",
        "im:chat.tabs:read",
        "im:chat.tabs:write_only",
        "im:chat.top_notice:write_only",
        "im:chat.widgets:read",
        "im:chat.widgets:write_only",
        "im:chat:create",
        "im:chat:delete",
        "im:chat:moderation:write_only",
        "im:chat:operate_as_owner",
        "im:chat:read",
        "im:chat:update",
        "im:message",
        "im:message.pins:read",
        "im:message.pins:write_only",
        "im:message.reactions:read",
        "im:message.reactions:write_only",
        "im:message:readonly",
        "im:message:send_as_bot",
        "sheets:spreadsheet.meta:read",
        "sheets:spreadsheet.meta:write_only",
        "sheets:spreadsheet:create",
        "sheets:spreadsheet:read",
        "sheets:spreadsheet:write_only",
        "task:task:read",
        "task:task:write",
        "task:tasklist:read",
        "task:tasklist:write",
        "wiki:member:create",
        "wiki:member:retrieve",
        "wiki:member:update",
        "wiki:wiki:readonly",
      ],
      user: [],
    },
  },
  null,
  2,
);

export interface FeishuSetupViewProps {
  onConnected: () => void;
  variant?: "page" | "modal";
  disabled?: boolean;
}

export function FeishuSetupView({
  onConnected,
  variant = "page",
  disabled,
}: FeishuSetupViewProps) {
  const { t } = useTranslation();
  const [activeStep, setActiveStep] = useState(0);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [jsonCopied, setJsonCopied] = useState(false);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(FEISHU_PERMISSIONS_JSON);
    setJsonCopied(true);
    setTimeout(() => setJsonCopied(false), 2000);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { error } = await postApiV1ChannelsFeishuConnect({
        body: { appId: appId.trim(), appSecret: appSecret.trim() },
      });
      if (error) {
        track("workspace_channel_config_submit", {
          channel: "feishu",
          success: false,
        });
        toast.error(error.message ?? t("feishuSetup.connectFailed"));
        return;
      }
      track("workspace_channel_config_submit", {
        channel: "feishu",
        success: true,
      });
      toast.success(t("feishuSetup.connectSuccess"));
      track("channel_ready", {
        channel: "feishu",
        channel_type: "feishu_app",
      });
      identify({ channels_connected: 1 });
      onConnected();
    } catch {
      track("workspace_channel_config_submit", {
        channel: "feishu",
        success: false,
      });
      toast.error(t("feishuSetup.connectFailed"));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className={variant === "modal" ? "" : ""}>
      {/* Step indicator */}
      <div className="grid grid-cols-3 gap-2 mb-6">
        {FEISHU_SETUP_STEP_KEYS.map((key, i) => (
          <button
            type="button"
            key={key}
            onClick={() => setActiveStep(i)}
            className="text-left cursor-pointer"
          >
            <div
              className={`h-1 rounded-full transition-all ${
                i <= activeStep ? "bg-[#3370FF]" : "bg-border"
              }`}
            />
            <div
              className={`text-[11px] font-semibold mt-2 transition-all ${
                i === activeStep
                  ? "text-[#3370FF]"
                  : i < activeStep
                    ? "text-text-secondary"
                    : "text-text-muted/50"
              }`}
            >
              {t("feishuSetup.step", { number: i + 1 })}
            </div>
            <div
              className={`text-[10px] mt-0.5 leading-tight transition-all ${
                i === activeStep ? "text-text-secondary" : "text-text-muted/40"
              }`}
            >
              {t(key)}
            </div>
          </button>
        ))}
      </div>

      {/* Step 1: Create App */}
      {activeStep === 0 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#3370FF]/10 text-[12px] font-bold text-[#3370FF] shrink-0">
              1
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                {t("feishuSetup.createTitle")}
              </h3>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                {t("feishuSetup.createDesc")}
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-3">
            <div className="space-y-2">
              {[
                t("feishuSetup.createStep1"),
                t("feishuSetup.createStep2"),
                t("feishuSetup.createStep3"),
                t("feishuSetup.createStep4"),
              ].map((item, i) => (
                <div key={item} className="flex gap-2.5 items-start">
                  <div className="flex justify-center items-center w-5 h-5 rounded-full bg-surface-3 text-[9px] font-bold text-text-muted shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <span className="text-[12px] text-text-secondary leading-relaxed">
                    {item}
                  </span>
                </div>
              ))}
            </div>
            <a
              href="https://open.feishu.cn/app"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex gap-1.5 items-center px-3.5 py-2 text-[12px] font-medium rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-border-hover hover:bg-surface-3 transition-all"
            >
              <ExternalLink size={12} />
              {t("feishuSetup.openConsole")}
            </a>
          </div>
        </div>
      )}

      {/* Step 2: Permissions */}
      {activeStep === 1 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#3370FF]/10 text-[12px] font-bold text-[#3370FF] shrink-0">
              2
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                {t("feishuSetup.permissionsTitle")}
              </h3>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                {t("feishuSetup.permissionsDesc")}
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-4">
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-2.5 bg-surface-3 border-b border-border">
                <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
                  {t("feishuSetup.permissionsJson")}
                </span>
                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md text-text-muted hover:text-text-primary hover:bg-surface-2 transition-all cursor-pointer"
                >
                  {jsonCopied ? (
                    <>
                      <Check size={11} className="text-emerald-500" />
                      <span className="text-emerald-500">
                        {t("feishuSetup.copied")}
                      </span>
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      {t("feishuSetup.copy")}
                    </>
                  )}
                </button>
              </div>
              <pre className="px-3.5 py-3 text-[11px] font-mono text-text-secondary leading-relaxed overflow-x-auto bg-surface-0">
                {FEISHU_PERMISSIONS_JSON}
              </pre>
            </div>
            <div className="space-y-2">
              {[
                t("feishuSetup.permStep1"),
                t("feishuSetup.permStep2"),
                t("feishuSetup.permStep3"),
                t("feishuSetup.permStep4"),
              ].map((item, i) => (
                <div key={item} className="flex gap-2.5 items-start">
                  <div className="flex justify-center items-center w-5 h-5 rounded-full bg-surface-3 text-[9px] font-bold text-text-muted shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <span className="text-[12px] text-text-secondary leading-relaxed">
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Credentials */}
      {activeStep === 2 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#3370FF]/10 text-[12px] font-bold text-[#3370FF] shrink-0">
              3
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                {t("feishuSetup.credentialsTitle")}
              </h3>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                {t("feishuSetup.credentialsDesc")}
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-4">
            <div>
              <div className="flex items-baseline gap-1.5 mb-1.5">
                <label
                  htmlFor="feishu-app-id"
                  className="text-[12px] text-text-primary font-medium"
                >
                  {t("feishuSetup.appIdLabel")}
                </label>
                <span className="text-[11px] text-text-muted">
                  {t("feishuSetup.appIdHint")}
                </span>
              </div>
              <Input
                id="feishu-app-id"
                type="text"
                placeholder={t("feishuSetup.appIdPlaceholder")}
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                className="text-[13px] font-mono"
              />
            </div>
            <div>
              <div className="flex items-baseline gap-1.5 mb-1.5">
                <label
                  htmlFor="feishu-app-secret"
                  className="text-[12px] text-text-primary font-medium"
                >
                  {t("feishuSetup.appSecretLabel")}
                </label>
              </div>
              <div className="relative">
                <Input
                  id="feishu-app-secret"
                  type="password"
                  placeholder={t("feishuSetup.appSecretPlaceholder")}
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  className="text-[13px] font-mono pr-9"
                />
                <Lock
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted/40"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleConnect}
              disabled={
                disabled || connecting || !appId.trim() || !appSecret.trim()
              }
              className="flex gap-1.5 items-center px-5 py-2.5 text-[13px] font-medium text-white rounded-lg bg-[#3370FF] hover:bg-[#2860E6] transition-all disabled:opacity-60 cursor-pointer"
            >
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {t("feishuSetup.verifyConnect")}
            </button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between items-center mt-5">
        <button
          type="button"
          onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
          disabled={activeStep === 0}
          className="flex gap-1.5 items-center text-[12px] text-text-muted hover:text-text-secondary transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        >
          <ArrowLeft size={13} />
          {t("feishuSetup.previous")}
        </button>
        {activeStep < FEISHU_SETUP_STEP_KEYS.length - 1 && (
          <button
            type="button"
            onClick={() => setActiveStep(activeStep + 1)}
            className="flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-white rounded-lg bg-[#3370FF] hover:bg-[#2860E6] transition-all cursor-pointer"
          >
            {t("feishuSetup.next")}
            <ChevronRight size={13} />
          </button>
        )}
      </div>

      {/* Help link */}
      <div className="flex gap-3 items-center p-4 mt-5 rounded-xl border bg-surface-1 border-border">
        <BookOpen size={14} className="text-[#3370FF] shrink-0" />
        <p className="text-[11px] text-text-muted leading-relaxed">
          {t("feishuSetup.helpText")}{" "}
          <a
            href="https://open.feishu.cn/document/home/introduction-to-custom-app-development/self-built-application-development-process"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#3370FF] hover:underline underline-offset-2 font-medium"
          >
            {t("feishuSetup.helpLinkText")}
          </a>{" "}
          {t("feishuSetup.helpSuffix")}
        </p>
      </div>
    </div>
  );
}
