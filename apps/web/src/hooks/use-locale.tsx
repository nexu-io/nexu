import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

export type Locale = "en" | "zh";

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const STORAGE_KEY = "nexu_locale";

function detectDefault(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    /* ignore */
  }
  const lang = navigator.language || "";
  return lang.startsWith("zh") ? "zh" : "en";
}

const LocaleContext = createContext<LocaleCtx>({
  locale: "en",
  setLocale: () => {},
  t: (k) => k,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectDefault);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: string) => {
      const dict = locale === "zh" ? zh : en;
      return (dict as Record<string, string>)[key] ?? key;
    },
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}

// ─── Translations ───

const en: Record<string, string> = {
  "brand.title.line1": "OpenClaw,",
  "brand.title.line2": "ready to use.",
  "brand.body":
    "Nexu turns OpenClaw into a truly ready-to-use product experience, bringing Feishu tools and top-tier model access into one unified workspace.",
  "brand.bullet.openclaw":
    "Turns OpenClaw into a truly out-of-the-box experience",
  "brand.bullet.feishu": "Deep support for Feishu tools and workflows",
  "brand.bullet.models": "Connect top-tier models",
  "brand.github": "Star us on GitHub",
  "welcome.pageTitle": "Welcome to Nexu",
  "welcome.mobileLabel": "Client",
  "welcome.title": "Choose how to start",
  "welcome.option.login.title": "Use your Nexu account",
  "welcome.option.login.badge": "Recommended",
  "welcome.option.login.description":
    "Complete browser-based sign in and instantly access Nexu hosted premium models and the full product experience.",
  "welcome.option.login.meta.1": "Google / GitHub / Email",
  "welcome.option.login.meta.2": "Browser OAuth",
  "welcome.option.login.meta.3": "Best for most users",
  "welcome.option.login.highlight.unlimited": "Unlimited usage",
  "welcome.option.byok.title": "Use your own models",
  "welcome.option.byok.badge": "BYOK",
  "welcome.option.byok.description":
    "Skip sign in and connect your own API keys directly. Local-first, flexible, and fully under your control.",
  "welcome.option.byok.meta.1": "No sign up required",
  "welcome.option.byok.meta.2": "Local configuration",
  "welcome.option.byok.meta.3": "Best for advanced users",
  "welcome.back": "Back to options",
  "welcome.byok.title": "Connect your models",
  "welcome.byok.subtitle":
    "No account required. Choose a provider and enter your API key. Every configuration stays under your control.",
  "welcome.byok.note":
    "Your API key is used only for this client configuration. You do not need to create a Nexu account first.",
  "welcome.byok.verify.loading": "Verifying...",
  "welcome.byok.verify.idle": "Verify connection",
  "welcome.byok.success": "Connected, enter Nexu",
  "welcome.customEndpoint": "API Base URL (e.g. http://localhost:11434/v1)",
  "auth.terms": "Terms of Service",
  "auth.privacy": "Privacy Policy",
};

const zh: Record<string, string> = {
  "brand.title.line1": "OpenClaw，",
  "brand.title.line2": "开箱即用",
  "brand.body":
    "Nexu 让 OpenClaw 变成一个安装即可使用的完整产品。飞书文档、日历、审批等工具能力开箱可用，同时接入 Claude、GPT 等顶级模型，所有工作都在一个工作台里完成。",
  "brand.bullet.openclaw": "安装即用，无需额外配置 OpenClaw",
  "brand.bullet.feishu": "飞书文档、日历、审批等工具能力开箱可用",
  "brand.bullet.models": "接入 Claude、GPT 等顶级模型",
  "brand.github": "在 GitHub 上 Star Nexu",
  "welcome.pageTitle": "欢迎来到 Nexu",
  "welcome.mobileLabel": "客户端",
  "welcome.title": "选择你的开始方式",
  "welcome.option.login.title": "使用 Nexu 账号",
  "welcome.option.login.badge": "推荐",
  "welcome.option.login.description":
    "通过浏览器授权登录后，直接使用 Nexu 官方预设的高级模型和完整体验。",
  "welcome.option.login.meta.1": "Google / GitHub / 邮箱",
  "welcome.option.login.meta.2": "Browser OAuth",
  "welcome.option.login.meta.3": "适合大多数用户",
  "welcome.option.login.highlight.unlimited": "无限量使用",
  "welcome.option.byok.title": "使用你自己的模型",
  "welcome.option.byok.badge": "BYOK",
  "welcome.option.byok.description":
    "不登录也可以开始，直接连接你自己的 API Key，本地优先，完全可控。",
  "welcome.option.byok.meta.1": "无需注册",
  "welcome.option.byok.meta.2": "本地配置",
  "welcome.option.byok.meta.3": "适合高级用户",
  "welcome.back": "返回选择",
  "welcome.byok.title": "连接你的模型",
  "welcome.byok.subtitle":
    "不需要账号，选择服务商并输入你的 API Key。所有配置都由你自己掌控。",
  "welcome.byok.note":
    "你的 API Key 只用于当前客户端配置，不会要求你先创建 Nexu 账号。",
  "welcome.byok.verify.loading": "验证中...",
  "welcome.byok.verify.idle": "验证连接",
  "welcome.byok.success": "连接成功，进入 Nexu",
  "welcome.customEndpoint": "API Base URL（例如 http://localhost:11434/v1）",
  "auth.terms": "服务条款",
  "auth.privacy": "隐私政策",
};
