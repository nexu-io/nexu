import { track } from "@/lib/tracking";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import "@/lib/api";
import { getApiV1Channels } from "../../lib/api/sdk.gen";

const SLACK_SVG = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" role="img">
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

const DISCORD_SVG = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="#5865F2" role="img">
    <title>Discord</title>
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const CHANNEL_OPTIONS: {
  id: string;
  name: string;
  icon: React.ReactNode;
  subtitle: string;
  recommended?: boolean;
}[] = [
  {
    id: "feishu",
    name: "飞书 / Feishu",
    icon: (
      <img
        width={22}
        height={22}
        alt="飞书"
        src="/feishu-logo.png"
        style={{ objectFit: "contain" }}
      />
    ),
    subtitle: "添加 nexu Bot",
    recommended: true,
  },
  {
    id: "slack",
    name: "Slack",
    icon: SLACK_SVG,
    subtitle: "添加 nexu Bot",
  },
  {
    id: "discord",
    name: "Discord",
    icon: DISCORD_SVG,
    subtitle: "添加 nexu Bot",
  },
];

export function HomePage() {
  const navigate = useNavigate();

  const { data: channelsData } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data } = await getApiV1Channels();
      return data;
    },
  });

  const connectedCount = channelsData?.channels?.length ?? 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Hero card */}
        <div className="mb-8 rounded-2xl overflow-hidden bg-surface-1 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="relative">
            <div className="aspect-[16/9] max-h-48 bg-surface-2">
              <video
                src="/nexu-alpha.mp4"
                poster="/nexu-alpha-poster.jpg"
                preload="auto"
                autoPlay
                loop
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>
            <h2
              className="absolute right-40 sm:right-56 top-[55%] -translate-y-1/2 text-[40px] sm:text-[52px] font-normal tracking-tight text-text-primary"
              style={{ fontFamily: "var(--font-script)" }}
            >
              nexu Alpha
            </h2>
          </div>
          <div className="px-6 py-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-text-primary leading-relaxed">
                  连接一个 IM 渠道，激活你的 Bot
                </p>
                <div className="mt-1">
                  <p className="text-[12px] text-text-muted leading-relaxed max-w-lg">
                    nexu 已就绪，选择一个平台将 Bot
                    部署到你的工作空间，即可开始使用。
                  </p>
                </div>
                <div className="flex items-center gap-3 mt-3 text-[11px] text-text-muted">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${connectedCount > 0 ? "bg-emerald-400" : "bg-amber-400 animate-pulse"}`}
                    />
                    {connectedCount > 0 ? "已连接" : "等待配置"}
                  </span>
                  <span>{connectedCount} 个渠道已连接</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Channel selection */}
        <div className="mb-8">
          <h2 className="text-[14px] font-semibold text-text-primary mb-3">
            选择渠道
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {CHANNEL_OPTIONS.map((ch) => (
              <button
                key={ch.id}
                type="button"
                onClick={() => {
                  track("home_channel_click", { channel: ch.id });
                  navigate("/workspace/channels");
                }}
                className="group relative flex items-center gap-3.5 px-4 py-4 rounded-xl border border-border bg-surface-1 hover:bg-surface-2 hover:border-border-hover transition-all text-left cursor-pointer active:scale-[0.98]"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-border"
                  style={{ backgroundColor: "rgba(255, 255, 255, 0.063)" }}
                >
                  {ch.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-text-primary">
                      {ch.name}
                    </span>
                    {ch.recommended && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide bg-accent/10 text-accent border border-accent/20">
                        推荐
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-text-muted">
                    {ch.subtitle}
                  </span>
                </div>
                <ArrowRight
                  size={14}
                  className="text-text-muted group-hover:text-text-secondary transition-colors shrink-0"
                />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
