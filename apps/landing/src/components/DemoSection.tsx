import * as amplitude from "@amplitude/unified";
import {
  BarChart3,
  ChevronDown,
  Code2,
  FileText,
  PenTool,
  Search,
} from "lucide-react";
import { useState } from "react";

interface SlackMessage {
  role: "user" | "bot";
  content: string;
  time: string;
  attachments?: { name: string; icon: typeof FileText; color: string }[] | null;
  result?: {
    borderColor: string;
    title: string;
    items: string[];
    link?: string;
  };
}

interface DemoScenario {
  key: string;
  label: string;
  icon: typeof Code2;
  channel: string;
  messages: SlackMessage[];
}

const DEMO_SCENARIOS: DemoScenario[] = [
  {
    key: "coding",
    label: "Build & Deploy",
    icon: Code2,
    channel: "#product-dev",
    messages: [
      {
        role: "user",
        content:
          "Build me a flashcard game for kids learning English — cute style, with pronunciation",
        time: "2:30 PM",
        attachments: null,
      },
      {
        role: "bot",
        content: "On it! Creating the English flashcard game now 🎴",
        time: "2:31 PM",
        result: {
          borderColor: "border-l-[#2eb67d]",
          title: "✅ Code complete",
          items: [
            "React flip-card game · 48 word cards · audio pronunciation",
            "Difficulty levels (easy/medium/hard) · scoring & progress tracking",
          ],
        },
      },
      {
        role: "user",
        content:
          "Awesome! Deploy it — I want to share the link with my friend's kids",
        time: "2:35 PM",
        attachments: null,
      },
      {
        role: "bot",
        content:
          "Deployed! Share the link and they can start playing right away 🚀",
        time: "2:35 PM",
        result: {
          borderColor: "border-l-[#1264a3]",
          title: "🌐 Live · english-cards.nexu.dev",
          items: [
            "Works on mobile & desktop · no install needed · offline support",
          ],
          link: "Open game →",
        },
      },
    ],
  },
  {
    key: "analysis",
    label: "Data Analysis",
    icon: BarChart3,
    channel: "#data-insights",
    messages: [
      {
        role: "user",
        content:
          "Analyze this sales data and find the fastest-growing categories",
        time: "10:15 AM",
        attachments: [
          {
            name: "sales-2026-Q1.csv",
            icon: FileText,
            color: "text-green-400",
          },
        ],
      },
      {
        role: "bot",
        content: "Analyzing 12,847 sales records...",
        time: "10:15 AM",
        result: {
          borderColor: "border-l-[#2eb67d]",
          title: "📊 Analysis complete",
          items: [
            "Top 3 categories: Smart Home (+142%), Pet Supplies (+98%), Health Food (+76%)",
            "Generated visual report · trend charts + category comparison + forecasts",
          ],
          link: "View full report →",
        },
      },
      {
        role: "user",
        content:
          "Now do a competitor pricing analysis for the Smart Home category",
        time: "10:20 AM",
        attachments: null,
      },
      {
        role: "bot",
        content: "Scraped competitor data from public sources.",
        time: "10:21 AM",
        result: {
          borderColor: "border-l-[#1264a3]",
          title: "📋 Competitor Pricing Report",
          items: [
            "Covers 8 competitors · 42 SKUs · price trends & recommended pricing range",
          ],
          link: "View report →",
        },
      },
    ],
  },
  {
    key: "content",
    label: "Content Creation",
    icon: PenTool,
    channel: "#marketing",
    messages: [
      {
        role: "user",
        content:
          "Write a product update blog post based on this week's changelog",
        time: "4:00 PM",
        attachments: [
          {
            name: "changelog-v0.4.md",
            icon: FileText,
            color: "text-purple-400",
          },
        ],
      },
      {
        role: "bot",
        content: "Generating blog post from changelog...",
        time: "4:01 PM",
        result: {
          borderColor: "border-l-[#2eb67d]",
          title: "✍️ Blog post ready",
          items: [
            'Title: "Nexu v0.4 — Your Lobster Just Got Smarter" · 1,200 words',
            "Generated cover image + SEO summary + Twitter Thread version",
          ],
          link: "Preview blog →",
        },
      },
      {
        role: "user",
        content: "Also generate an investor weekly update email",
        time: "4:10 PM",
        attachments: null,
      },
      {
        role: "bot",
        content: "Combined blog content with this week's metrics.",
        time: "4:11 PM",
        result: {
          borderColor: "border-l-[#1264a3]",
          title: "📧 Investor Update ready",
          items: [
            "Key metrics, product progress, next week's plan · formatted as email",
          ],
          link: "Preview email →",
        },
      },
    ],
  },
];

const SLACK_CHANNELS = [
  "all-refly-team",
  "product-dev",
  "data-insights",
  "marketing",
  "random",
];
const SLACK_DMS = [
  { name: "Marc Chan", online: true },
  { name: "Sarah", online: true },
  { name: "Yixian", online: false },
  { name: "Nexu 🦞", online: true },
];

function SlackMsgRow({ msg }: { msg: SlackMessage }) {
  const isBot = msg.role === "bot";
  return (
    <div className="flex gap-2 px-3 sm:px-5 py-1 hover:bg-[#f8f8f8] group">
      {isBot ? (
        <div className="flex justify-center items-center w-9 h-9 rounded-lg shrink-0 bg-[#f0ebff] text-base mt-0.5">
          🦞
        </div>
      ) : (
        <div className="flex justify-center items-center w-9 h-9 rounded-lg shrink-0 bg-[#e8f5e9] mt-0.5">
          <span className="text-[14px]">👤</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex gap-1.5 items-baseline">
          <span className="text-[14px] font-bold text-[#1d1c1d]">
            {isBot ? "Nexu" : "Eli"}
          </span>
          {isBot && (
            <span className="text-[10px] font-medium text-[#616061] bg-[#e8e8e8] px-1 py-px rounded">
              APP
            </span>
          )}
          <span className="text-[11px] text-[#616061]">{msg.time}</span>
        </div>
        <div className="text-[14px] text-[#1d1c1d] leading-[1.6] mt-px">
          {isBot && (
            <span className="text-[#1264a3] bg-[#e8f0fe] px-0.5 rounded">
              @Eli
            </span>
          )}{" "}
          {msg.content}
        </div>
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="flex gap-2 mt-1.5">
            {msg.attachments.map((att) => (
              <div
                key={att.name}
                className="flex gap-1.5 items-center px-2.5 py-1.5 rounded border border-[#ddd] bg-white text-[12px] text-[#616061]"
              >
                <att.icon size={13} className={att.color} />
                {att.name}
              </div>
            ))}
          </div>
        )}
        {msg.result && (
          <div
            className={`mt-2 border-l-[3px] ${msg.result.borderColor} rounded-r bg-[#f8f8f8] border border-[#e0e0e0] border-l-0`}
          >
            <div className="px-3 py-2">
              <div className="text-[13px] font-bold text-[#1d1c1d] mb-0.5">
                {msg.result.title}
              </div>
              {msg.result.items.map((item) => (
                <div
                  key={item}
                  className="text-[13px] text-[#616061] leading-relaxed"
                >
                  {item}
                </div>
              ))}
              {msg.result.link && (
                <span className="inline-block mt-1 text-[13px] text-[#1264a3] hover:underline cursor-pointer">
                  {msg.result.link}
                </span>
              )}
            </div>
          </div>
        )}
        {isBot && (
          <div className="flex gap-1.5 mt-1.5">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-[#d0d0d0] bg-white text-[11px] cursor-default">
              ✅ <span className="text-[#1264a3] font-medium">1</span>
            </span>
            {msg.result && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border border-[#d0d0d0] bg-white text-[11px] cursor-default">
                🚀 <span className="text-[#1264a3] font-medium">2</span>
              </span>
            )}
          </div>
        )}
        {msg.result && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <div className="w-5 h-5 rounded bg-[#f0ebff] flex items-center justify-center text-[10px]">
              🦞
            </div>
            <span className="text-[12px] text-[#1264a3] font-medium hover:underline cursor-pointer">
              {msg.result.link ? "2 replies" : "1 reply"}
            </span>
            <span className="text-[11px] text-[#616061]">
              Last reply today at {msg.time}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SlackDemo({ scenarioKey }: { scenarioKey: string }) {
  const scenario =
    DEMO_SCENARIOS.find((s) => s.key === scenarioKey) ?? DEMO_SCENARIOS[0];
  const activeChannel = scenario.channel.replace("#", "");

  return (
    <div className="overflow-x-auto rounded-xl shadow-2xl border border-[#ccc]/30 bg-white">
      <div className="min-w-[760px]">
        <div className="flex gap-2 items-center px-4 py-2 bg-[#3f0e40]">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
          <div className="flex-1 flex justify-center">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-white/10 text-[11px] text-white/60">
              <Search size={11} />
              Search Nexu Workspace
            </div>
          </div>
          <div className="w-6 h-6 rounded-lg bg-[#e8f5e9] flex items-center justify-center text-[10px]">
            👤
          </div>
        </div>
        <div className="flex" style={{ height: 480 }}>
          <div className="w-[44px] shrink-0 bg-[#3f0e40] flex flex-col items-center py-2 gap-3 border-r border-[#5c2d5e]">
            <div className="w-7 h-7 rounded-lg bg-white/15 flex items-center justify-center text-[12px] text-white/80">
              🏠
            </div>
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-[12px] text-white/50">
              💬
            </div>
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-[12px] text-white/50">
              📁
            </div>
            <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-[12px] text-white/50">
              ⋯
            </div>
          </div>
          <div className="w-[150px] shrink-0 bg-[#3f0e40] py-2.5 px-1.5 border-r border-[#5c2d5e] overflow-hidden">
            <div className="flex items-center gap-1.5 px-2 mb-3">
              <span className="text-[13px] font-bold text-white/90">
                Nexu Team
              </span>
              <ChevronDown size={12} className="text-white/50" />
            </div>
            <div className="text-[11px] font-medium text-white/40 px-2 mb-1">
              Channels
            </div>
            <div className="space-y-px mb-2">
              {SLACK_CHANNELS.map((ch) => (
                <div
                  key={ch}
                  className={`px-2 py-[3px] rounded text-[12px] truncate ${ch === activeChannel ? "bg-[#1264a3] text-white font-medium" : "text-white/60 hover:bg-white/5"}`}
                >
                  <span className="text-white/40 mr-0.5">#</span> {ch}
                </div>
              ))}
            </div>
            <div className="text-[11px] font-medium text-white/40 px-2 mb-1">
              Direct Messages
            </div>
            <div className="space-y-px">
              {SLACK_DMS.map((dm) => (
                <div
                  key={dm.name}
                  className="flex gap-1.5 items-center px-2 py-[3px] text-[12px] text-white/60 truncate"
                >
                  <div
                    className={`w-2 h-2 rounded-full shrink-0 ${dm.online ? "bg-[#2bac76]" : "border border-white/30"}`}
                  />
                  <span className="truncate">{dm.name}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col flex-1 min-w-0 bg-white">
            <div className="flex items-center px-5 py-2.5 border-b border-[#e0e0e0]">
              <span className="text-[15px] font-bold text-[#1d1c1d]">
                # {activeChannel}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto py-3 space-y-2">
              {scenario.messages.map((msg) => (
                <SlackMsgRow key={msg.time + msg.role} msg={msg} />
              ))}
            </div>
            <div className="px-5 pb-3">
              <div className="rounded-lg border border-[#ccc] overflow-hidden">
                <div className="flex items-center gap-0.5 px-2 py-1 border-b border-[#e8e8e8] bg-[#fafafa]">
                  {["B", "I", "U", "S"].map((btn) => (
                    <div
                      key={btn}
                      className="w-6 h-6 rounded flex items-center justify-center text-[12px] font-bold text-[#999] hover:bg-[#eee] cursor-default"
                    >
                      {btn}
                    </div>
                  ))}
                  <div className="w-px h-4 bg-[#ddd] mx-1" />
                  <div className="w-6 h-6 rounded flex items-center justify-center text-[11px] text-[#999]">
                    🔗
                  </div>
                  <div className="w-6 h-6 rounded flex items-center justify-center text-[11px] text-[#999]">
                    ≡
                  </div>
                  <div className="w-6 h-6 rounded flex items-center justify-center text-[11px] text-[#999]">
                    {"{}"}
                  </div>
                </div>
                <div className="px-3 py-2">
                  <span className="text-[13px] text-[#aaa]">
                    Message #{activeChannel}
                  </span>
                </div>
                <div className="flex items-center justify-between px-2 py-1 border-t border-[#e8e8e8]">
                  <div className="flex items-center gap-0.5">
                    <div className="w-7 h-7 rounded flex items-center justify-center text-[13px] text-[#999] hover:bg-[#eee] cursor-default">
                      ➕
                    </div>
                    <div className="w-7 h-7 rounded flex items-center justify-center text-[13px] text-[#999] hover:bg-[#eee] cursor-default">
                      😊
                    </div>
                    <div className="w-7 h-7 rounded flex items-center justify-center text-[13px] text-[#999] hover:bg-[#eee] cursor-default">
                      @
                    </div>
                    <div className="w-7 h-7 rounded flex items-center justify-center text-[13px] text-[#999] hover:bg-[#eee] cursor-default">
                      📎
                    </div>
                  </div>
                  <div className="w-7 h-7 rounded flex items-center justify-center bg-[#007a5a] text-white text-[12px] cursor-default">
                    ▶
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DemoSection() {
  const [activeDemo, setActiveDemo] = useState("coding");

  return (
    <section
      id="scenarios"
      className="px-4 sm:px-6 py-12 sm:py-16 mx-auto max-w-5xl"
    >
      <div className="flex flex-wrap gap-2 justify-center mb-8">
        {DEMO_SCENARIOS.map((s) => (
          <button
            type="button"
            key={s.key}
            onClick={() => {
              setActiveDemo(s.key);
              amplitude.track("landing_try_live_click", { channel: s.key });
            }}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium transition-colors cursor-pointer ${
              activeDemo === s.key
                ? "bg-accent text-accent-fg"
                : "bg-surface-1 text-text-secondary border border-border hover:border-border-hover"
            }`}
          >
            <s.icon size={14} />
            {s.label}
          </button>
        ))}
      </div>
      <div className="mx-auto max-w-4xl">
        <SlackDemo scenarioKey={activeDemo} />
        <div className="text-center mt-4 text-[12px] text-text-muted">
          @Nexu in your favorite chat app — say what you need, get the result
          delivered
        </div>
      </div>
    </section>
  );
}
