import { identify, track } from "@/lib/tracking";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import "@/lib/api";
import { client } from "@/lib/api";
import { whatsappQrImageUrl, whatsappWaMeUrl } from "@/lib/whatsapp";
import {
  getV1ChannelsSlackOauthUrl,
  getV1Me,
  postV1ChannelsDiscordConnect,
  postV1ChannelsSlackConnect,
} from "../../lib/api/sdk.gen";

// ── Constants ──────────────────────────────────────────────

interface OnboardingData {
  role: string;
  company: string;
  useCases: string[];
  referralSource: string;
  referralDetail: string;
  channelVotes: string[];
  selectedAvatar: string;
  avatarVotes: string[];
  customAvatarRequest: string;
}

const STEPS = [
  { id: "identity", label: "Profile" },
  { id: "usecase", label: "Use cases" },
  { id: "referral", label: "Referral" },
  { id: "channels", label: "Channels" },
  { id: "avatar", label: "Avatar" },
];

const CAPABILITY_PILLS = [
  { emoji: "\u{1F4BB}", label: "Code & Deploy" },
  { emoji: "\u{1F4CA}", label: "Data Analysis" },
  { emoji: "\u270D\uFE0F", label: "Content" },
  { emoji: "\u{1F50D}", label: "Research" },
  { emoji: "\u2699\uFE0F", label: "Automation" },
];

const ROLE_OPTIONS = [
  { value: "ecommerce", label: "E-commerce", icon: "\u{1F6D2}" },
  {
    value: "content-creator",
    label: "Content Creator / Influencer",
    icon: "\u270D\uFE0F",
  },
  { value: "designer", label: "Designer", icon: "\u{1F3A8}" },
  { value: "pm", label: "Product Manager", icon: "\u{1F4CC}" },
  { value: "ops-marketing", label: "Ops / Marketing", icon: "\u{1F4C8}" },
  {
    value: "developer",
    label: "Developer / Engineer / Data Analyst",
    icon: "\u{1F4BB}",
  },
  { value: "educator", label: "Educator", icon: "\u{1F4DA}" },
  { value: "founder", label: "Founder / Manager", icon: "\u{1F331}" },
  { value: "research", label: "Research", icon: "\u{1F50D}" },
  { value: "student", label: "Student", icon: "\u{1F9D1}\u200D\u{1F393}" },
  { value: "finance", label: "Finance / Consulting", icon: "\u{1F4BC}" },
  { value: "other", label: "Other", icon: "\u{1F33F}" },
];

const USE_CASE_OPTIONS = [
  { value: "coding", label: "Code & Deploy", icon: "\u{1F4BB}" },
  { value: "content", label: "Content Creation", icon: "\u270D\uFE0F" },
  { value: "data", label: "Data Analysis", icon: "\u{1F4CA}" },
  { value: "customer", label: "Customer Support", icon: "\u{1F3A7}" },
  { value: "sales", label: "Sales & Outreach", icon: "\u{1F91D}" },
  { value: "ops", label: "Operations", icon: "\u2699\uFE0F" },
  { value: "research", label: "Research", icon: "\u{1F50D}" },
  { value: "other", label: "Other", icon: "\u2728" },
];

const REFERRAL_OPTIONS = [
  { value: "producthunt", label: "Product Hunt", icon: "\u{1F680}" },
  { value: "twitter", label: "X / Twitter", icon: "\u{1F426}" },
  { value: "instagram", label: "Instagram", icon: "\u{1F4F8}" },
  { value: "youtube", label: "YouTube", icon: "\u25B6\uFE0F" },
  { value: "reddit", label: "Reddit", icon: "\u{1F525}" },
  { value: "discord", label: "Discord community", icon: "\u{1F4AC}" },
  { value: "github", label: "GitHub", icon: "\u{1F9D1}\u200D\u{1F4BB}" },
  { value: "search", label: "Search engine", icon: "\u{1F50D}" },
  { value: "friend", label: "Friend / colleague", icon: "\u{1F465}" },
  { value: "podcast", label: "Podcast", icon: "\u{1F3A7}" },
  { value: "other", label: "Other", icon: "\u{1F4DD}" },
];

interface ChannelOption {
  id: string;
  name: string;
  protocol: string;
  color: string;
  connectable: boolean;
  recommended?: boolean;
}

const CHANNEL_OPTIONS: ChannelOption[] = [
  {
    id: "slack",
    name: "Slack",
    protocol: "Socket Mode",
    color: "#4A154B",
    connectable: true,
    recommended: true,
  },
  {
    id: "discord",
    name: "Discord",
    protocol: "Bot API",
    color: "#5865F2",
    connectable: true,
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    protocol: "QR link",
    color: "#25D366",
    connectable: true,
  },
  {
    id: "telegram",
    name: "Telegram",
    protocol: "Bot API",
    color: "#26A5E4",
    connectable: false,
  },
  {
    id: "irc",
    name: "IRC",
    protocol: "Server + Nick",
    color: "#6B7280",
    connectable: false,
  },
  {
    id: "google-chat",
    name: "Google Chat",
    protocol: "Chat API",
    color: "#00AC47",
    connectable: false,
  },
  {
    id: "signal",
    name: "Signal",
    protocol: "signal-cli",
    color: "#3A76F0",
    connectable: false,
  },
  {
    id: "imessage",
    name: "iMessage",
    protocol: "imsg",
    color: "#34C759",
    connectable: false,
  },
  {
    id: "feishu",
    name: "Feishu / Lark",
    protocol: "Lark",
    color: "#3370FF",
    connectable: false,
  },
  {
    id: "nostr",
    name: "Nostr",
    protocol: "NIP-04 DMs",
    color: "#8B5CF6",
    connectable: false,
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    protocol: "Bot Framework",
    color: "#6264A7",
    connectable: false,
  },
  {
    id: "mattermost",
    name: "Mattermost",
    protocol: "plugin",
    color: "#0058CC",
    connectable: false,
  },
  {
    id: "nextcloud-talk",
    name: "Nextcloud Talk",
    protocol: "self-hosted",
    color: "#0082C9",
    connectable: false,
  },
  {
    id: "matrix",
    name: "Matrix",
    protocol: "plugin",
    color: "#0DBD8B",
    connectable: false,
  },
  {
    id: "bluebubbles",
    name: "BlueBubbles",
    protocol: "macOS app",
    color: "#2196F3",
    connectable: false,
  },
  {
    id: "line",
    name: "LINE",
    protocol: "Messaging API",
    color: "#06C755",
    connectable: false,
  },
  {
    id: "zalo-bot",
    name: "Zalo",
    protocol: "Bot API",
    color: "#0068FF",
    connectable: false,
  },
  {
    id: "zalo-personal",
    name: "Zalo",
    protocol: "Personal Account",
    color: "#0068FF",
    connectable: false,
  },
];

interface AvatarSkill {
  name: string;
  description: string;
}
interface AvatarOption {
  id: string;
  name: string;
  nameEn: string;
  tagline: string;
  description: string;
  skills: AvatarSkill[];
  available: boolean;
  color: string;
  bgGradient: string;
}

const AVATAR_OPTIONS: AvatarOption[] = [
  {
    id: "nexu-alpha",
    name: "Nexu Alpha",
    nameEn: "Nexu Alpha",
    tagline: "Does a bit of everything \u2014 seriously",
    description:
      "Build, analyze, write, research, automate \u2014 one avatar that does it all",
    skills: [
      {
        name: "Build websites",
        description:
          "Turn your ideas into working websites, tools, or applications",
      },
      {
        name: "Data analysis",
        description:
          "Upload spreadsheets, ask questions, get charts and insights instantly",
      },
      {
        name: "Content creation",
        description:
          "Blog posts, social media, emails, reports \u2014 written in your voice",
      },
      {
        name: "Research",
        description:
          "Deep-dive into any topic and get structured, sourced summaries",
      },
      {
        name: "Automation",
        description:
          "Repetitive tasks? Set it once and let your avatar handle the rest",
      },
      {
        name: "Deploy",
        description: "One-click publish so everyone can access what you built",
      },
    ],
    available: true,
    color: "#6366f1",
    bgGradient: "from-indigo-50 to-violet-50",
  },
  {
    id: "ai-sales",
    name: "AI Sales",
    nameEn: "AI Sales",
    tagline: "Find customers & close deals",
    description:
      "From prospecting to closing \u2014 your full sales pipeline covered",
    skills: [
      {
        name: "Research accounts",
        description:
          "Dig into customer backgrounds and find what they care about",
      },
      {
        name: "Prep for meetings",
        description: "Get talking points and agendas ready before every call",
      },
      {
        name: "Analyze competitors",
        description: "Know what competitors are doing and find your edge",
      },
      {
        name: "Draft outreach",
        description: "Write emails and messages that get replies",
      },
      {
        name: "Daily briefings",
        description:
          "Who to contact today, what to follow up \u2014 all in one place",
      },
      {
        name: "Create sales assets",
        description: "Proposals, decks, ROI analyses \u2014 generated fast",
      },
    ],
    available: false,
    color: "#10b981",
    bgGradient: "from-emerald-50 to-green-50",
  },
  {
    id: "ai-support",
    name: "AI Support",
    nameEn: "AI Support",
    tagline: "Reply to customers 24/7",
    description: "Instant, professional responses to every customer question",
    skills: [
      {
        name: "Auto-triage tickets",
        description: "Automatically sort and prioritize incoming messages",
      },
      {
        name: "Draft replies",
        description:
          "Quick professional responses \u2014 you review, then send",
      },
      {
        name: "Handle escalations",
        description:
          "Complex issues get packaged and routed to the right person",
      },
      {
        name: "Remember every customer",
        description:
          "Past conversations, purchases, preferences \u2014 all tracked",
      },
      {
        name: "Build a knowledge base",
        description: "Turn repeated questions into docs to reduce busywork",
      },
    ],
    available: false,
    color: "#3b82f6",
    bgGradient: "from-blue-50 to-cyan-50",
  },
  {
    id: "ai-pm",
    name: "AI Product Manager",
    nameEn: "Product Manager",
    tagline: "Figure out what to build & why",
    description:
      "From fuzzy ideas to clear plans \u2014 product strategy made simple",
    skills: [
      {
        name: "Write specs",
        description: "Turn vague ideas into clear product requirements",
      },
      {
        name: "Prioritize work",
        description: "Too much to do? Figure out what comes first",
      },
      {
        name: "Understand users",
        description: "What do users really want? Find answers from feedback",
      },
      {
        name: "Analyze competitors",
        description: "What are others building? Where's your advantage?",
      },
      {
        name: "Create reports",
        description:
          "Weekly updates, status reports \u2014 generated in seconds",
      },
      {
        name: "Track metrics",
        description: "How are key numbers looking? Let data tell the story",
      },
    ],
    available: false,
    color: "#ec4899",
    bgGradient: "from-pink-50 to-rose-50",
  },
  {
    id: "ai-marketing",
    name: "AI Marketing",
    nameEn: "AI Marketing",
    tagline: "Get more people to know your product",
    description: "Content, campaigns, analytics \u2014 marketing on autopilot",
    skills: [
      {
        name: "Write content",
        description:
          "Blog posts, social media, newsletters \u2014 produced fast",
      },
      {
        name: "Plan campaigns",
        description:
          "When to launch what, how much to spend \u2014 all planned out",
      },
      {
        name: "Keep brand consistent",
        description: "Make sure everything sounds like it comes from one brand",
      },
      {
        name: "Watch competitors",
        description: "Track competitor marketing strategies and market trends",
      },
      {
        name: "Analyze performance",
        description:
          "Which channels bring the most customers? Is the spend worth it?",
      },
    ],
    available: false,
    color: "#f59e0b",
    bgGradient: "from-amber-50 to-orange-50",
  },
  {
    id: "ai-designer",
    name: "AI Designer",
    nameEn: "AI Designer",
    tagline: "Make things look great & work well",
    description: "Page design, image creation, user experience optimization",
    skills: [
      {
        name: "Review designs",
        description: "Does this page look good? What can improve? Get feedback",
      },
      {
        name: "Prepare handoffs",
        description:
          "Annotated designs that developers can build from directly",
      },
      {
        name: "Manage design systems",
        description: "Colors, fonts, buttons \u2014 keep everything consistent",
      },
      {
        name: "Write UI copy",
        description:
          "Button labels, tooltips, error messages \u2014 all thought through",
      },
      {
        name: "Understand user behavior",
        description: "Where do users get stuck? Find the problems",
      },
      {
        name: "Check accessibility",
        description: "Make sure everyone can use your product comfortably",
      },
    ],
    available: false,
    color: "#8b5cf6",
    bgGradient: "from-purple-50 to-fuchsia-50",
  },
  {
    id: "custom",
    name: "Custom Role",
    nameEn: "Custom Role",
    tagline: "Can't find what you need? Tell us",
    description: "Describe what you want your AI to do \u2014 we'll build it",
    skills: [],
    available: false,
    color: "#a3a3a3",
    bgGradient: "from-gray-50 to-slate-50",
  },
];

// ── Pill button component ──────────────────────────────────

function Pill({
  selected,
  onClick,
  icon,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-medium border transition-colors cursor-pointer ${
        selected
          ? "bg-accent text-accent-foreground border-accent"
          : "bg-surface-1 text-text-secondary border-border hover:border-border-hover"
      }`}
    >
      <span className="text-[12px]">{icon}</span>
      {label}
    </button>
  );
}

// ── Step 1: Identity ───────────────────────────────────────

function IdentityStep({
  data,
  onNext,
}: {
  data: Partial<OnboardingData>;
  onNext: (d: Partial<OnboardingData>) => void;
}) {
  const [role, setRole] = useState(data.role || "");
  const [roleDetail, setRoleDetail] = useState("");
  const [company, setCompany] = useState(data.company || "");

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-[22px] font-bold text-text-primary tracking-tight">
          What's your role?
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          This helps us personalize your experience
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {ROLE_OPTIONS.map((opt) => (
          <Pill
            key={opt.value}
            selected={role === opt.value}
            onClick={() => {
              setRole(opt.value);
              if (opt.value !== "other") setRoleDetail("");
            }}
            icon={opt.icon}
            label={opt.label}
          />
        ))}
      </div>

      <div
        className="overflow-hidden transition-all duration-300 ease-out"
        style={{
          maxHeight: role === "other" ? "80px" : "0px",
          opacity: role === "other" ? 1 : 0,
          marginBottom: role === "other" ? "24px" : "0px",
        }}
      >
        <input
          type="text"
          value={roleDetail}
          onChange={(e) => setRoleDetail(e.target.value)}
          placeholder="Tell us your role..."
          className="w-full px-3.5 py-2.5 bg-surface-1 border border-border rounded-lg text-text-primary placeholder:text-text-muted text-[13px] focus:outline-none focus:border-border-hover transition-colors"
        />
      </div>

      <div>
        <label
          htmlFor="onboarding-company"
          className="block text-[13px] text-text-secondary mb-1.5"
        >
          Company / Organization{" "}
          <span className="text-text-muted">(optional)</span>
        </label>
        <input
          id="onboarding-company"
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Where do you work?"
          className="w-full px-3.5 py-2.5 bg-surface-1 border border-border rounded-lg text-text-primary placeholder:text-text-muted text-[13px] focus:outline-none focus:border-border-hover transition-colors"
        />
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={() =>
            role &&
            onNext({
              role:
                role === "other" && roleDetail.trim()
                  ? `other:${roleDetail.trim()}`
                  : role,
              company: company.trim(),
            })
          }
          disabled={!role}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent-hover text-accent-foreground font-medium rounded-md text-[13px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        >
          Continue <span className="text-[11px]">&rarr;</span>
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Use Cases ──────────────────────────────────────

function UseCaseStep({
  data,
  onNext,
  onBack,
}: {
  data: Partial<OnboardingData>;
  onNext: (d: Partial<OnboardingData>) => void;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(data.useCases || []);
  const [otherDetail, setOtherDetail] = useState("");

  const toggle = (value: string) => {
    setSelected((prev) => {
      const next = prev.includes(value)
        ? prev.filter((v) => v !== value)
        : [...prev, value];
      if (!next.includes("other")) setOtherDetail("");
      return next;
    });
  };

  const buildUseCases = () =>
    selected.map((v) =>
      v === "other" && otherDetail.trim() ? `other:${otherDetail.trim()}` : v,
    );

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-[22px] font-bold text-text-primary tracking-tight">
          What will you use Nexu for?
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Select all that apply
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {USE_CASE_OPTIONS.map((opt) => (
          <Pill
            key={opt.value}
            selected={selected.includes(opt.value)}
            onClick={() => toggle(opt.value)}
            icon={opt.icon}
            label={opt.label}
          />
        ))}
      </div>

      <div
        className="overflow-hidden transition-all duration-300 ease-out"
        style={{
          maxHeight: selected.includes("other") ? "80px" : "0px",
          opacity: selected.includes("other") ? 1 : 0,
          marginBottom: selected.includes("other") ? "24px" : "0px",
        }}
      >
        <input
          type="text"
          value={otherDetail}
          onChange={(e) => setOtherDetail(e.target.value)}
          placeholder="Tell us what you'd like to do..."
          className="w-full px-3.5 py-2.5 bg-surface-1 border border-border rounded-lg text-text-primary placeholder:text-text-muted text-[13px] focus:outline-none focus:border-border-hover transition-colors"
        />
      </div>

      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={onBack}
          className="text-[13px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        >
          &larr; Back
        </button>
        <button
          type="button"
          onClick={() =>
            selected.length > 0 && onNext({ useCases: buildUseCases() })
          }
          disabled={selected.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent-hover text-accent-foreground font-medium rounded-md text-[13px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        >
          Continue <span className="text-[11px]">&rarr;</span>
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Referral ───────────────────────────────────────

function ReferralStep({
  data,
  onNext,
  onBack,
}: {
  data: Partial<OnboardingData>;
  onNext: (d: Partial<OnboardingData>) => void;
  onBack: () => void;
}) {
  const [source, setSource] = useState(data.referralSource || "");
  const [detail, setDetail] = useState(data.referralDetail || "");

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-[22px] font-bold text-text-primary tracking-tight">
          How did you hear about Nexu?
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Help us understand what's working
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {REFERRAL_OPTIONS.map((opt) => (
          <Pill
            key={opt.value}
            selected={source === opt.value}
            onClick={() => {
              setSource(opt.value);
              if (opt.value !== "other") setDetail("");
            }}
            icon={opt.icon}
            label={opt.label}
          />
        ))}
      </div>

      <div
        className="overflow-hidden transition-all duration-300 ease-out"
        style={{
          maxHeight: source === "other" ? "80px" : "0px",
          opacity: source === "other" ? 1 : 0,
          marginBottom: source === "other" ? "24px" : "0px",
        }}
      >
        <input
          type="text"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Tell us more..."
          className="w-full px-3.5 py-2.5 bg-surface-1 border border-border rounded-lg text-text-primary placeholder:text-text-muted text-[13px] focus:outline-none focus:border-border-hover transition-colors"
        />
      </div>

      <div className="flex justify-between items-center">
        <button
          type="button"
          onClick={onBack}
          className="text-[13px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        >
          &larr; Back
        </button>
        <button
          type="button"
          onClick={() =>
            source &&
            onNext({ referralSource: source, referralDetail: detail.trim() })
          }
          disabled={!source}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent-hover text-accent-foreground font-medium rounded-md text-[13px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        >
          Continue <span className="text-[11px]">&rarr;</span>
        </button>
      </div>
    </div>
  );
}

// ── Channel connect modal ──────────────────────────────────

// ── Setup step definitions for onboarding channel connect ──

interface SetupStep {
  title: string;
  bullets: string[];
  copyable?: string;
  hasInputs?: boolean;
  link?: { label: string; url: string };
}

function renderBold(text: string) {
  const parts = text.split(/(\*\*.+?\*\*)/g);
  if (parts.length === 1) return text;
  const result: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    if (part.startsWith("**") && part.endsWith("**")) {
      result.push(
        <strong key={i} className="font-semibold text-text-primary">
          {part.slice(2, -2)}
        </strong>,
      );
    } else {
      result.push(<span key={i}>{part}</span>);
    }
  }
  return result;
}

const SLACK_SETUP_STEPS: SetupStep[] = [
  {
    title: "Create Slack App",
    link: {
      label: "Open Slack API Dashboard",
      url: "https://api.slack.com/apps",
    },
    bullets: [
      'Click **"Create New App"**',
      'Select **"From scratch"**',
      "Set the App Name to **Nexu**",
      "Choose the workspace to install it to",
    ],
  },
  {
    title: "Configure Bot Permissions",
    bullets: [
      'Go to your app \u2192 **"OAuth & Permissions"** tab',
      'Scroll to **"Bot Token Scopes"**',
      "**Add** these scopes:",
      "\u2003\u00B7 chat:write \u2014 send messages",
      "\u2003\u00B7 app_mentions:read \u2014 receive @mentions",
      "\u2003\u00B7 files:read \u2014 read uploaded files",
      "\u2003\u00B7 channels:history \u2014 read channel messages",
    ],
  },
  {
    title: "Install & Connect",
    bullets: [
      'Go to your app \u2192 **"Install App"**',
      'Click **"Install to Workspace"** and authorize',
      'After install, go to **"OAuth & Permissions"** \u2192 copy the **"Bot User OAuth Token"** (starts with xoxb-)',
      'Then go to **"Basic Information"** \u2192 **"App Credentials"** \u2192 copy the **"Signing Secret"**',
      "Paste both values below:",
    ],
    hasInputs: true,
  },
  {
    title: "Configure Events & Test",
    bullets: [
      'Go to your app \u2192 **"Event Subscriptions"**',
      'Toggle **"Enable Events"** on',
      "Enter this Request URL:",
    ],
    copyable: "/api/slack/events",
  },
];

// Extra bullets shown after the copyable URL in the last Slack step
const SLACK_EVENTS_EXTRA = [
  'Under **"Subscribe to bot events"**, add:',
  "\u2003\u00B7 app_mention",
  "\u2003\u00B7 message.channels",
  'Click **"Save Changes"**',
  "In any Slack channel, type **/invite @Nexu**",
  'Send **"@Nexu hello"** to test',
];

const DISCORD_SETUP_STEPS: SetupStep[] = [
  {
    title: "Create Discord Application",
    link: {
      label: "Open Discord Developer Portal",
      url: "https://discord.com/developers/applications",
    },
    bullets: [
      'Click **"New Application"**',
      "Set the App Name to **Nexu**",
      "Save and go to the **Bot** page",
    ],
  },
  {
    title: "Configure Bot Permissions",
    bullets: [
      'Go to Application \u2192 **"Bot"**',
      "**Enable** these Privileged Gateway Intents:",
      "\u2003\u00B7 MESSAGE CONTENT INTENT",
      "\u2003\u00B7 SERVER MEMBERS INTENT",
    ],
  },
  { title: "Enter Credentials & Connect", hasInputs: true, bullets: [] },
  {
    title: "Invite Bot & Test",
    bullets: [
      "Click the button below to invite the bot to your server",
      "Select the server and **authorize**",
      'Send **"@Nexu hello"** in a channel to test',
    ],
  },
];

const SETUP_STEPS_MAP: Record<string, SetupStep[]> = {
  slack: SLACK_SETUP_STEPS,
  discord: DISCORD_SETUP_STEPS,
};

const CREDENTIAL_FIELDS: Record<
  string,
  { label1: string; placeholder1: string; label2: string; placeholder2: string }
> = {
  slack: {
    label1: "Bot User OAuth Token",
    placeholder1: "xoxb-xxxxxxxxxxxxx",
    label2: "Signing Secret",
    placeholder2: "xxxxxxxxxxxxxxxxxxxxxxx",
  },
  discord: {
    label1: "Application ID",
    placeholder1: "123456789012345678",
    label2: "Bot Token",
    placeholder2: "MTxx...",
  },
};

function ChannelConnectModal({
  channelId,
  channelName,
  channelColor,
  onClose,
  onConnected,
}: {
  channelId: string;
  channelName: string;
  channelColor: string;
  onClose: () => void;
  onConnected: (channelId: string) => void;
}) {
  const steps = SETUP_STEPS_MAP[channelId];
  const fields = CREDENTIAL_FIELDS[channelId];
  const [stepIdx, setStepIdx] = useState(0);
  const [field1, setField1] = useState("");
  const [field2, setField2] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // WhatsApp QR connect
  if (channelId === "whatsapp" || !steps || !fields) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
        onClick={onClose}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div
          className="w-full max-w-[400px] bg-surface-1 rounded-2xl border border-border shadow-xl p-6 text-center"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">{"\u{1F4F1}"}</span>
          </div>
          <p className="text-[13px] font-medium text-text-primary mb-1">
            Scan to connect on WhatsApp
          </p>
          <p className="text-[11px] text-text-muted mb-4">
            Use your WhatsApp app to scan this QR code.
          </p>
          <div className="mx-auto mb-4 w-full max-w-[220px] rounded-xl border border-border bg-white p-2">
            <img
              src={whatsappQrImageUrl}
              alt="WhatsApp QR code"
              className="w-full h-auto rounded-lg"
            />
          </div>
          <a
            href={whatsappWaMeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-3 py-2 text-[12px] font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
          >
            Open WhatsApp
          </a>
          <p className="mt-3 mb-5 text-[11px] text-text-muted break-all">
            <a
              href={whatsappWaMeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-secondary underline underline-offset-2"
            >
              {whatsappWaMeUrl}
            </a>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[13px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer rounded-lg"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const step = steps[stepIdx];
  if (!step) return null;

  const handleSlackOAuth = async () => {
    setOauthLoading(true);
    try {
      const { data, error } = await getV1ChannelsSlackOauthUrl();
      if (error) {
        toast.error("Failed to get Slack OAuth URL");
        return;
      }
      if (data?.url) window.location.href = data.url;
    } catch {
      toast.error("Failed to start Slack connection");
    } finally {
      setOauthLoading(false);
    }
  };

  const handleConnect = async () => {
    if (!field1.trim() || !field2.trim()) return;
    setConnecting(true);
    try {
      if (channelId === "slack") {
        const { error } = await postV1ChannelsSlackConnect({
          body: { botToken: field1, signingSecret: field2 },
        });
        if (error) throw new Error("Connection failed");
      } else if (channelId === "discord") {
        const { error } = await postV1ChannelsDiscordConnect({
          body: { botToken: field2, appId: field1 },
        });
        if (error) throw new Error("Connection failed");
      }
      toast.success(`${channelName} connected!`);
      track("channel_ready", { channel: channelId });
      identify({ primary_platform: channelId, channels_connected: 1 });
      // Advance to next step (events/test) if there is one, otherwise close
      if (stepIdx < steps.length - 1) {
        setStepIdx(stepIdx + 1);
      } else {
        onConnected(channelId);
      }
    } catch {
      toast.error(`Failed to connect ${channelName}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isLast = stepIdx === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
      onClick={() => !connecting && !oauthLoading && onClose()}
      onKeyDown={(e) =>
        e.key === "Escape" && !connecting && !oauthLoading && onClose()
      }
    >
      <div
        className="w-full max-w-[560px] bg-surface-1 rounded-2xl border border-border shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: channelColor }}
          >
            <span className="text-white text-[12px] font-bold">
              {channelName[0]}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-semibold text-text-primary">
              Connect {channelName}
            </h3>
            <p className="text-[11px] text-text-tertiary">
              Step {stepIdx + 1} of {steps.length}
            </p>
          </div>
          {channelId === "slack" && (
            <button
              type="button"
              onClick={handleSlackOAuth}
              disabled={oauthLoading}
              className="px-3 py-1.5 rounded-lg text-[11px] font-medium text-white transition-colors cursor-pointer disabled:opacity-60 shrink-0"
              style={{ backgroundColor: channelColor }}
            >
              {oauthLoading ? "Redirecting..." : "OAuth (quick setup)"}
            </button>
          )}
        </div>

        {/* Step progress */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex gap-1">
            {steps.map((step, i) => (
              <div
                key={step.title}
                className="flex-1 h-[3px] rounded-full overflow-hidden bg-border-subtle"
              >
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: i <= stepIdx ? "100%" : "0%",
                    backgroundColor: channelColor,
                    opacity: i === stepIdx ? 0.5 : 1,
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="px-6 py-4 max-h-[420px] overflow-y-auto">
          <h4 className="text-[14px] font-semibold text-text-primary mb-1">
            {step.title}
          </h4>

          {step.link && (
            <a
              href={step.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium mb-3 transition-colors"
              style={{ color: channelColor }}
            >
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              {step.link.label}
            </a>
          )}

          {step.bullets.length > 0 && (
            <div className="space-y-1.5 mb-4">
              {step.bullets.map((b) => (
                <div
                  key={b}
                  className="text-[12px] leading-relaxed text-text-secondary"
                >
                  {b.startsWith("\u2003") ? (
                    <span className="ml-3 text-text-muted font-mono text-[11px]">
                      {b.trim()}
                    </span>
                  ) : (
                    <span className="flex gap-2 items-start">
                      <span
                        className="mt-1.5 w-1 h-1 rounded-full shrink-0"
                        style={{ backgroundColor: channelColor, opacity: 0.5 }}
                      />
                      {renderBold(b)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {channelId === "discord" &&
            step.title.includes("Invite") &&
            field1.trim() && (
              <a
                href={`https://discord.com/oauth2/authorize?client_id=${field1}&scope=bot&permissions=68608`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-medium text-white rounded-lg mb-4 transition-colors"
                style={{ backgroundColor: channelColor }}
              >
                <svg
                  aria-hidden="true"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Add Bot to Server
              </a>
            )}

          {step.copyable &&
            (() => {
              const copyable = step.copyable as string;
              const fullUrl = copyable.startsWith("/")
                ? `${window.location.origin}${copyable}`
                : copyable;
              return (
                <>
                  <div className="flex gap-2 items-center p-2.5 rounded-lg border bg-surface-0 border-border font-mono text-[11px] mb-3">
                    <code className="flex-1 break-all text-text-secondary">
                      {fullUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy(fullUrl)}
                      className="p-1 rounded transition-colors text-text-muted hover:text-text-primary shrink-0 cursor-pointer"
                    >
                      {copied ? (
                        <span className="text-[10px] text-success">
                          {"\u2713"}
                        </span>
                      ) : (
                        <svg
                          aria-hidden="true"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      )}
                    </button>
                  </div>
                  {channelId === "slack" && stepIdx === steps.length - 1 && (
                    <div className="space-y-1.5 mb-4">
                      {SLACK_EVENTS_EXTRA.map((b) => (
                        <div
                          key={b}
                          className="text-[12px] leading-relaxed text-text-secondary"
                        >
                          {b.startsWith("\u2003") ? (
                            <span className="ml-3 text-text-muted font-mono text-[11px]">
                              {b.trim()}
                            </span>
                          ) : (
                            <span className="flex gap-2 items-start">
                              <span
                                className="mt-1.5 w-1 h-1 rounded-full shrink-0"
                                style={{
                                  backgroundColor: channelColor,
                                  opacity: 0.5,
                                }}
                              />
                              {renderBold(b)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}

          {step.hasInputs && fields && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="channel-field1"
                  className="block text-[11px] font-medium text-text-muted"
                >
                  {fields.label1}
                </label>
                <input
                  id="channel-field1"
                  type="text"
                  value={field1}
                  onChange={(e) => setField1(e.target.value)}
                  placeholder={fields.placeholder1}
                  className="w-full px-3.5 py-2.5 bg-surface-0 border border-border rounded-lg text-text-primary placeholder:text-text-muted text-[13px] font-mono focus:outline-none focus:border-border-hover transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="channel-field2"
                  className="block text-[11px] font-medium text-text-muted"
                >
                  {fields.label2}
                </label>
                <input
                  id="channel-field2"
                  type="password"
                  value={field2}
                  onChange={(e) => setField2(e.target.value)}
                  placeholder={fields.placeholder2}
                  className="w-full px-3.5 py-2.5 bg-surface-0 border border-border rounded-lg text-text-primary placeholder:text-text-muted text-[13px] font-mono focus:outline-none focus:border-border-hover transition-colors"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-6 py-4 border-t border-border">
          <button
            type="button"
            onClick={() => (stepIdx > 0 ? setStepIdx(stepIdx - 1) : onClose())}
            className="px-3 py-1.5 text-[12px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          >
            {stepIdx > 0 ? "\u2190 Previous" : "Cancel"}
          </button>
          {step.hasInputs ? (
            <button
              type="button"
              onClick={handleConnect}
              disabled={!field1.trim() || !field2.trim() || connecting}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium rounded-lg text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              style={{ backgroundColor: channelColor }}
            >
              {connecting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting...
                </>
              ) : (
                "Connect"
              )}
            </button>
          ) : isLast ? (
            <button
              type="button"
              onClick={() => onConnected(channelId)}
              className="px-4 py-1.5 text-[12px] font-medium rounded-lg text-white cursor-pointer"
              style={{ backgroundColor: channelColor }}
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStepIdx(stepIdx + 1)}
              className="px-4 py-1.5 text-[12px] font-medium rounded-lg text-white cursor-pointer"
              style={{ backgroundColor: channelColor }}
            >
              Next &rarr;
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Step 4: Channels ───────────────────────────────────────

function ChannelsStep({
  data,
  onNext,
  onBack,
}: {
  data: Partial<OnboardingData>;
  onNext: (d: Partial<OnboardingData>) => void;
  onBack: () => void;
}) {
  const [votes, setVotes] = useState<string[]>(data.channelVotes || []);
  const [connected, setConnected] = useState<string[]>([]);
  const [modal, setModal] = useState<string | null>(null);

  const toggleVote = (channelId: string) => {
    setVotes((prev) =>
      prev.includes(channelId)
        ? prev.filter((v) => v !== channelId)
        : [...prev, channelId],
    );
  };
  const handleConnected = (channelId: string) => {
    setConnected((prev) =>
      prev.includes(channelId) ? prev : [...prev, channelId],
    );
    setModal(null);
  };
  const modalChannel = modal
    ? CHANNEL_OPTIONS.find((c) => c.id === modal)
    : null;

  return (
    <div className="relative">
      <div className="mb-6">
        <h2 className="text-[22px] font-bold text-text-primary tracking-tight">
          Connect your channels
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Connect or vote for channels you'd like supported
        </p>
      </div>

      <div className="space-y-1 max-h-[380px] overflow-y-auto pr-1">
        {CHANNEL_OPTIONS.map((channel) => {
          const isConnected = connected.includes(channel.id);
          const isVoted = votes.includes(channel.id);
          return (
            <div
              key={channel.id}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg transition-colors ${isConnected ? "bg-emerald-500/5" : isVoted ? "bg-accent/5" : "hover:bg-surface-2"}`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: isConnected
                      ? "var(--color-success)"
                      : channel.color,
                  }}
                />
                <span className="text-[13px] font-medium text-text-primary">
                  {channel.name}
                </span>
                <span className="text-[11px] text-text-tertiary">
                  ({channel.protocol})
                </span>
                {channel.recommended && !isConnected && (
                  <span className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded-full font-medium">
                    recommended
                  </span>
                )}
              </div>
              {isConnected ? (
                <span className="text-[12px] text-success font-medium">
                  {"\u2713"} Connected
                </span>
              ) : channel.connectable ? (
                <button
                  type="button"
                  onClick={() => setModal(channel.id)}
                  className="px-3 py-1 text-[12px] font-medium rounded-md text-white shrink-0 cursor-pointer transition-colors"
                  style={{ backgroundColor: channel.color }}
                >
                  Connect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => toggleVote(channel.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors shrink-0 cursor-pointer ${isVoted ? "bg-accent text-accent-foreground border-accent" : "text-text-tertiary border-border hover:border-border-hover hover:text-text-secondary"}`}
                >
                  {isVoted ? "\u2713 Voted" : "Vote"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {votes.length > 0 && (
        <p className="mt-4 text-[12px] text-text-tertiary">
          {votes.length} vote{votes.length > 1 ? "s" : ""} &mdash; we'll
          prioritize the most requested
        </p>
      )}

      <div className="mt-6 flex justify-between items-center">
        <button
          type="button"
          onClick={onBack}
          className="text-[13px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        >
          &larr; Back
        </button>
        <button
          type="button"
          onClick={() => onNext({ channelVotes: votes })}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent-hover text-accent-foreground font-medium rounded-md text-[13px] transition-colors cursor-pointer"
        >
          Continue <span className="text-[11px]">&rarr;</span>
        </button>
      </div>

      {modal && modalChannel && (
        <ChannelConnectModal
          channelId={modal}
          channelName={modalChannel.name}
          channelColor={modalChannel.color}
          onClose={() => setModal(null)}
          onConnected={handleConnected}
        />
      )}
    </div>
  );
}

// ── Step 5: Avatar ─────────────────────────────────────────

function AvatarStep({
  data,
  onComplete,
  onBack,
}: {
  data: Partial<OnboardingData>;
  onComplete: (d: Partial<OnboardingData>) => void;
  onBack: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(
    Math.max(
      0,
      AVATAR_OPTIONS.findIndex(
        (a) => a.id === (data.selectedAvatar || "nexu-alpha"),
      ),
    ),
  );
  const [selected, setSelected] = useState<string | null>(
    data.selectedAvatar || null,
  );
  const [votes, setVotes] = useState<string[]>(data.avatarVotes || []);
  const [customRequest, setCustomRequest] = useState("");

  const avatar = AVATAR_OPTIONS[currentIndex] ?? AVATAR_OPTIONS[0];
  if (!avatar) return null;
  const isCustom = avatar.id === "custom";
  const isSelected = selected === avatar.id;

  const goPrev = useCallback(() => {
    setCurrentIndex(
      (prev) => (prev - 1 + AVATAR_OPTIONS.length) % AVATAR_OPTIONS.length,
    );
  }, []);
  const goNext = useCallback(() => {
    setCurrentIndex((prev) => (prev + 1) % AVATAR_OPTIONS.length);
  }, []);
  const toggleVote = (id: string) => {
    setVotes((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    );
  };

  return (
    <div>
      <div className="mb-5 text-center">
        <h2 className="text-[22px] font-bold text-text-primary tracking-tight">
          Meet your AI team
        </h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Pick who you'd like to work with first
        </p>
      </div>

      <div className="relative flex items-center gap-2">
        <button
          type="button"
          onClick={goPrev}
          className="w-8 h-8 rounded-lg border border-border hover:border-border-hover bg-surface-0 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors shrink-0 cursor-pointer"
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="flex-1 h-[420px] flex flex-col items-center overflow-hidden">
          <div className="flex flex-col items-center w-full h-full">
            <div
              className={`relative w-40 h-44 rounded-2xl mb-3 overflow-hidden bg-gradient-to-b ${avatar.bgGradient} border-2 transition-all shrink-0 ${isSelected ? "border-accent shadow-lg shadow-accent/10" : "border-border"}`}
            >
              <div className="w-full h-full flex items-center justify-center">
                <span className="text-5xl opacity-60">
                  {avatar.available ? "\u{1F99E}" : "\u{1F512}"}
                </span>
              </div>
              {isSelected && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center text-accent-foreground text-[10px] bg-accent shadow-md">
                  {"\u2713"}
                </div>
              )}
              {!avatar.available && !isCustom && (
                <div className="absolute inset-x-0 bottom-0 py-1.5 text-center text-[10px] font-medium text-white bg-gradient-to-t from-black/60 via-black/40 to-transparent">
                  Coming soon
                </div>
              )}
            </div>

            <div className="text-center mb-3 shrink-0">
              <h3 className="text-[15px] font-semibold text-text-primary">
                {avatar.name}
              </h3>
              <p className="text-[12px] text-text-secondary mt-0.5">
                {avatar.tagline}
              </p>
            </div>

            {isCustom ? (
              <div className="w-full space-y-3 flex-1 min-h-0">
                <textarea
                  value={customRequest}
                  onChange={(e) => setCustomRequest(e.target.value)}
                  placeholder="Describe the AI role you'd like..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 bg-surface-1 border border-border rounded-lg text-text-primary placeholder:text-text-muted text-[13px] focus:outline-none focus:border-border-hover transition-colors resize-none"
                />
                <p className="text-[11px] text-text-muted text-center">
                  Your input shapes what we build next
                </p>
                <button
                  type="button"
                  onClick={() => toggleVote(avatar.id)}
                  className={`w-full py-2 rounded-full text-[12px] font-medium border transition-colors cursor-pointer ${votes.includes(avatar.id) ? "bg-accent text-accent-foreground border-accent" : "text-text-secondary border-border hover:border-border-hover"}`}
                >
                  {votes.includes(avatar.id)
                    ? "\u2713 Voted"
                    : "Vote for custom roles"}
                </button>
              </div>
            ) : avatar.available ? (
              <div className="w-full space-y-3 flex-1 min-h-0 flex flex-col">
                <button
                  type="button"
                  onClick={() => setSelected(avatar.id)}
                  className={`w-full py-2 rounded-md text-[13px] font-medium transition-colors cursor-pointer shrink-0 ${isSelected ? "bg-accent text-accent-foreground" : "border border-border text-text-primary hover:border-border-hover"}`}
                >
                  {isSelected ? "\u2713 Selected" : "Select this avatar"}
                </button>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {avatar.skills.map((skill) => (
                    <span
                      key={skill.name}
                      title={skill.description}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-surface-1 border border-border-subtle text-text-secondary cursor-default"
                    >
                      <span
                        className="w-1 h-1 rounded-full shrink-0"
                        style={{ backgroundColor: avatar.color }}
                      />
                      {skill.name}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-text-muted text-center mt-auto shrink-0">
                  {avatar.description}
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 flex-1 min-h-0">
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {avatar.skills.map((skill) => (
                    <span
                      key={skill.name}
                      title={skill.description}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-surface-1 border border-border-subtle text-text-muted cursor-default"
                    >
                      <span
                        className="w-1 h-1 rounded-full shrink-0"
                        style={{ backgroundColor: avatar.color, opacity: 0.4 }}
                      />
                      {skill.name}
                    </span>
                  ))}
                </div>
                <span className="text-[10px] text-text-muted bg-surface-1 px-2 py-0.5 rounded-full border border-border">
                  Coming soon
                </span>
                <button
                  type="button"
                  onClick={() => toggleVote(avatar.id)}
                  className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors cursor-pointer ${votes.includes(avatar.id) ? "bg-accent text-accent-foreground border-accent" : "text-text-secondary border-border hover:border-border-hover"}`}
                >
                  {votes.includes(avatar.id)
                    ? "\u2713 Voted"
                    : "Vote for this role"}
                </button>
                {votes.includes(avatar.id) && (
                  <p className="text-[11px] text-success text-center">
                    Thanks! We'll prioritize this based on votes.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={goNext}
          className="w-8 h-8 rounded-lg border border-border hover:border-border-hover bg-surface-0 flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors shrink-0 cursor-pointer"
        >
          <svg
            aria-hidden="true"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="flex justify-center gap-1.5 mt-4">
        {AVATAR_OPTIONS.map((a, i) => (
          <button
            type="button"
            key={a.id}
            onClick={() => setCurrentIndex(i)}
            className="relative cursor-pointer"
          >
            <div
              className={`w-[6px] h-[6px] rounded-full transition-all ${i === currentIndex ? "scale-[1.5]" : "bg-border-hover"}`}
              style={
                i === currentIndex ? { backgroundColor: avatar.color } : {}
              }
            />
            {selected === a.id && i !== currentIndex && (
              <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-success" />
            )}
          </button>
        ))}
      </div>

      {selected && (
        <p
          className="mt-3 text-[11px] text-center font-medium"
          style={{
            color: AVATAR_OPTIONS.find((a) => a.id === selected)?.color,
          }}
        >
          Selected: {AVATAR_OPTIONS.find((a) => a.id === selected)?.name}
        </p>
      )}

      <div className="mt-5 flex justify-between items-center">
        <button
          type="button"
          onClick={onBack}
          className="text-[13px] text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        >
          &larr; Back
        </button>
        <button
          type="button"
          onClick={() =>
            onComplete({
              selectedAvatar: selected || "nexu-alpha",
              avatarVotes: votes,
              customAvatarRequest: customRequest.trim(),
            })
          }
          disabled={!selected}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-accent hover:bg-accent-hover text-accent-foreground font-medium rounded-md text-[13px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        >
          Complete setup <span className="text-[11px]">&rarr;</span>
        </button>
      </div>
    </div>
  );
}

// ── Main Onboarding Page ───────────────────────────────────

const STORAGE_KEY = "nexu_onboarding";

function loadProgress(): { step: number; data: Partial<OnboardingData> } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { step: parsed.step ?? 0, data: parsed.data ?? {} };
    }
  } catch {
    /* ignore */
  }
  return { step: 0, data: {} };
}

function saveProgress(step: number, data: Partial<OnboardingData>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, data }));
  } catch {
    /* ignore */
  }
}

function clearProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const saved = loadProgress();
  const [currentStep, setCurrentStep] = useState(saved.step);
  const [data, setData] = useState<Partial<OnboardingData>>(saved.data);

  const returnTo = searchParams.get("returnTo") || "/workspace";

  const trackedStart = useRef(false);
  useEffect(() => {
    if (!trackedStart.current) {
      track("onboarding_start");
      trackedStart.current = true;
    }
  }, []);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await getV1Me();
      return data;
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (payload: OnboardingData) => {
      const resp = await client.post({
        url: "/v1/onboarding/complete",
        body: payload,
        headers: { "Content-Type": "application/json" },
      });
      if (resp.error) throw new Error("Failed to save onboarding");
      return resp.data;
    },
    onSuccess: () => {
      clearProgress();
      queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("Welcome to Nexu!");
      navigate(returnTo);
    },
    onError: () => {
      toast.error("Failed to save. Please try again.");
    },
  });

  const handleNext = useCallback(
    (stepData?: Partial<OnboardingData>) => {
      const newData = stepData ? { ...data, ...stepData } : data;
      const newStep =
        currentStep < STEPS.length - 1 ? currentStep + 1 : currentStep;
      if (stepData) setData(newData);
      if (currentStep < STEPS.length - 1) setCurrentStep(newStep);
      saveProgress(newStep, newData);
      // Identify user properties per step
      if (currentStep === 0 && newData.role)
        identify({ user_role: newData.role });
      if (currentStep === 1 && newData.useCases)
        identify({ use_cases: newData.useCases });
      if (currentStep === 2 && newData.referralSource)
        identify({ referral_source: newData.referralSource });
    },
    [currentStep, data],
  );

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      const newStep = currentStep - 1;
      setCurrentStep(newStep);
      saveProgress(newStep, data);
    }
  }, [currentStep, data]);

  const handleComplete = useCallback(
    (stepData?: Partial<OnboardingData>) => {
      const finalData = { ...data, ...stepData } as OnboardingData;
      setData(finalData);
      if (finalData.selectedAvatar)
        identify({ avatar_choice: finalData.selectedAvatar });
      completeMutation.mutate(finalData);
    },
    [data, completeMutation],
  );

  if (profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (profile?.onboardingCompleted) {
    clearProgress();
    return <Navigate to={returnTo} replace />;
  }

  const renderStep = () => {
    const props = { data };
    switch (currentStep) {
      case 0:
        return <IdentityStep {...props} onNext={handleNext} />;
      case 1:
        return (
          <UseCaseStep {...props} onNext={handleNext} onBack={handleBack} />
        );
      case 2:
        return (
          <ReferralStep {...props} onNext={handleNext} onBack={handleBack} />
        );
      case 3:
        return (
          <ChannelsStep {...props} onNext={handleNext} onBack={handleBack} />
        );
      case 4:
        return (
          <AvatarStep
            {...props}
            onComplete={handleComplete}
            onBack={handleBack}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left panel — dark sidebar */}
      <div className="hidden lg:flex w-[400px] shrink-0 bg-[#111111] flex-col justify-between p-8 relative overflow-hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex justify-center items-center w-7 h-7 rounded-lg bg-white/15">
            <span className="text-xs font-bold text-white">N</span>
          </div>
          <span className="text-[14px] font-semibold text-white/90">Nexu</span>
        </div>

        <div>
          <h2 className="text-[32px] font-bold text-white leading-[1.15] mb-4">
            Almost there.
            <br />
            Let's set up
            <br />
            your clone.
          </h2>
          <p className="text-[13px] text-white/45 leading-relaxed mb-6 max-w-[280px]">
            A few quick questions so your digital coworker knows how to help you
            best.
          </p>
          <div className="flex flex-wrap gap-2">
            {CAPABILITY_PILLS.map((p) => (
              <span
                key={p.label}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-white/[0.07] text-white/60 border border-white/[0.06]"
              >
                <span className="text-[11px]">{p.emoji}</span>
                {p.label}
              </span>
            ))}
          </div>
        </div>

        <div className="text-[11px] text-white/20">
          &copy; 2026 Nexu by Refly
        </div>
      </div>

      {/* Right panel — content */}
      <div className="flex-1 flex flex-col bg-surface-0">
        {/* Mobile logo */}
        <div className="flex items-center gap-2.5 px-6 h-14 border-b border-border lg:hidden">
          <div className="flex justify-center items-center w-7 h-7 rounded-lg bg-accent">
            <span className="text-xs font-bold text-accent-foreground">N</span>
          </div>
          <span className="text-sm font-semibold tracking-tight text-text-primary">
            Nexu
          </span>
        </div>

        {/* Step indicator */}
        <div className="px-8 pt-8 pb-6">
          <div className="max-w-md mx-auto">
            <div className="flex items-center gap-1">
              {STEPS.map((step, i) => (
                <div
                  key={step.id}
                  className="flex-1 h-[3px] rounded-full overflow-hidden bg-border-subtle"
                >
                  <div
                    className="h-full rounded-full bg-text-primary transition-all duration-400 ease-out"
                    style={{
                      width: i <= currentStep ? "100%" : "0%",
                      opacity: i === currentStep ? 0.4 : 1,
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex mt-2.5">
              {STEPS.map((step, i) => (
                <span
                  key={step.id}
                  className={`flex-1 text-center text-[11px] transition-colors duration-300 ${i <= currentStep ? "text-text-secondary" : "text-text-muted"}`}
                >
                  {step.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Step content */}
        <main className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-lg">{renderStep()}</div>
        </main>
      </div>
    </div>
  );
}
