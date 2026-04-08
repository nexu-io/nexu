import { defineConfig } from "vitepress";

const localePreferenceScript = `
(() => {
  const storageKey = "nexu-docs-locale";
  const zhPrefix = "/zh/";
  const jaPrefix = "/ja/";

  const normalizePath = (path) => {
    if (path === "/zh") return zhPrefix;
    if (path === "/ja") return jaPrefix;
    return path;
  };

  const getLocaleFromPath = (path) => {
    const normalizedPath = normalizePath(path);
    if (normalizedPath === zhPrefix || normalizedPath.startsWith(zhPrefix)) {
      return "zh";
    }
    if (normalizedPath === jaPrefix || normalizedPath.startsWith(jaPrefix)) {
      return "ja";
    }
    return "en";
  };

  const getPreferredLocale = () => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === "en" || stored === "zh" || stored === "ja") {
        return stored;
      }
    } catch {}

    const languages = Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];

    if (languages.some((language) => String(language).toLowerCase().startsWith("zh"))) {
      return "zh";
    }
    if (languages.some((language) => String(language).toLowerCase().startsWith("ja"))) {
      return "ja";
    }
    return "en";
  };

  const setPreferredLocale = (locale) => {
    try {
      window.localStorage.setItem(storageKey, locale);
    } catch {}
  };

  const pathname = normalizePath(window.location.pathname);

  if (pathname === "/" || pathname === zhPrefix || pathname === jaPrefix) {
    const preferredLocale = getPreferredLocale();
    const targetPath = preferredLocale === "zh" ? zhPrefix : preferredLocale === "ja" ? jaPrefix : "/";

    if (pathname !== targetPath) {
      window.location.replace(targetPath + window.location.search + window.location.hash);
      return;
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const link = target.closest("a[href]");
    if (!(link instanceof HTMLAnchorElement)) {
      return;
    }

    if (link.target && link.target !== "_self") {
      return;
    }

    const href = link.getAttribute("href");
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("http://") ||
      href.startsWith("https://")
    ) {
      return;
    }

    const nextUrl = new URL(link.href, window.location.origin);
    if (nextUrl.origin !== window.location.origin) {
      return;
    }

    setPreferredLocale(getLocaleFromPath(nextUrl.pathname));
  }, { capture: true });
})();
`;

const enSidebar = [
  {
    text: "Get Started",
    items: [
      { text: "Introduction", link: "/" },
      { text: "One-Minute Quick Start", link: "/guide/quickstart" },
      { text: "Key Concepts", link: "/guide/concepts" },
    ],
  },
  {
    text: "Configuration",
    items: [
      {
        text: "Channel Configuration",
        link: "/guide/channels",
        items: [
          { text: "WeCom", link: "/guide/channels/wecom" },
          { text: "WeChat", link: "/guide/channels/wechat" },
          { text: "Feishu", link: "/guide/channels/feishu" },
          { text: "QQ", link: "/guide/channels/qq" },
          { text: "DingTalk", link: "/guide/channels/dingtalk" },
          { text: "Slack", link: "/guide/channels/slack" },
          { text: "Discord", link: "/guide/channels/discord" },
          { text: "Telegram", link: "/guide/channels/telegram" },
          { text: "WhatsApp", link: "/guide/channels/whatsapp" },
        ],
      },
      { text: "Model Configuration", link: "/guide/models" },
      { text: "Skill Installation", link: "/guide/skills" },
      { text: "Seedance 2.0 Video Generation", link: "/guide/seedance" },
    ],
  },
  {
    text: "Help",
    items: [
      { text: "Update Guide", link: "/guide/update" },
      { text: "Troubleshooting", link: "/guide/troubleshooting" },
    ],
  },
  {
    text: "Community",
    items: [
      { text: "Contributing", link: "/guide/contributing" },
      { text: "Contact Us", link: "/guide/contact" },
      { text: "Star Us on GitHub", link: "/guide/star" },
      { text: "Earn Points by Sharing", link: "/guide/rewards" },
      { text: "Changelog", link: "https://github.com/nexu-io/nexu/releases" },
    ],
  },
];

const jaSidebar = [
  {
    text: "はじめに",
    items: [
      { text: "イントロダクション", link: "/ja/" },
      { text: "1分クイックスタート", link: "/ja/guide/quickstart" },
      { text: "基本コンセプト", link: "/ja/guide/concepts" },
    ],
  },
  {
    text: "設定",
    items: [
      {
        text: "チャンネル設定",
        link: "/ja/guide/channels",
        items: [
          { text: "WeCom", link: "/ja/guide/channels/wecom" },
          { text: "Feishu", link: "/ja/guide/channels/feishu" },
          { text: "QQ", link: "/ja/guide/channels/qq" },
          { text: "DingTalk", link: "/ja/guide/channels/dingtalk" },
          { text: "Slack", link: "/ja/guide/channels/slack" },
          { text: "Discord", link: "/ja/guide/channels/discord" },
          { text: "Telegram", link: "/ja/guide/channels/telegram" },
          { text: "WhatsApp", link: "/ja/guide/channels/whatsapp" },
        ],
      },
      { text: "モデル設定", link: "/ja/guide/models" },
      { text: "スキルインストール", link: "/ja/guide/skills" },
      { text: "Seedance 2.0 動画生成", link: "/ja/guide/seedance" },
    ],
  },
  {
    text: "ヘルプ",
    items: [
      { text: "アップデートガイド", link: "/ja/guide/update" },
      { text: "トラブルシューティング", link: "/ja/guide/troubleshooting" },
    ],
  },
  {
    text: "コミュニティ",
    items: [
      { text: "コントリビュート", link: "/ja/guide/contributing" },
      { text: "お問い合わせ", link: "/ja/guide/contact" },
      { text: "GitHub で Star", link: "/ja/guide/star" },
      { text: "シェアでポイント獲得", link: "/ja/guide/rewards" },
      { text: "更新ログ", link: "https://github.com/nexu-io/nexu/releases" },
    ],
  },
];

const zhSidebar = [
  {
    text: "快速开始",
    items: [
      { text: "介绍", link: "/zh/" },
      { text: "一分钟快速上手", link: "/zh/guide/quickstart" },
      { text: "核心概念", link: "/zh/guide/concepts" },
    ],
  },
  {
    text: "配置指南",
    items: [
      {
        text: "渠道配置",
        link: "/zh/guide/channels",
        items: [
          { text: "微信", link: "/zh/guide/channels/wechat" },
          { text: "企业微信", link: "/zh/guide/channels/wecom" },
          { text: "飞书", link: "/zh/guide/channels/feishu" },
          { text: "QQ", link: "/zh/guide/channels/qq" },
          { text: "钉钉", link: "/zh/guide/channels/dingtalk" },
          { text: "Slack", link: "/zh/guide/channels/slack" },
          { text: "Discord", link: "/zh/guide/channels/discord" },
          { text: "Telegram", link: "/zh/guide/channels/telegram" },
          { text: "WhatsApp", link: "/zh/guide/channels/whatsapp" },
        ],
      },
      { text: "模型配置", link: "/zh/guide/models" },
      { text: "技能安装", link: "/zh/guide/skills" },
      { text: "Seedance 2.0 视频生成", link: "/zh/guide/seedance" },
      { text: "Seedance 2.0 视频生成（Windows 版）", link: "/zh/guide/seedance-windows" },
    ],
  },
  {
    text: "帮助",
    items: [
      { text: "Windows 内测使用指南", link: "/zh/guide/windows-beta" },
      { text: "更新指南", link: "/zh/guide/update" },
      { text: "修复指南", link: "/zh/guide/troubleshooting" },
    ],
  },
  {
    text: "社区",
    items: [
      { text: "参与贡献", link: "/zh/guide/contributing" },
      { text: "联系我们", link: "/zh/guide/contact" },
      { text: "给我们 Star", link: "/zh/guide/star" },
      { text: "分享获得积分", link: "/zh/guide/rewards" },
      { text: "更新日志", link: "https://github.com/nexu-io/nexu/releases" },
    ],
  },
];

export default defineConfig({
  title: "nexu",
  description: "nexu documentation for channels, models, and skills.",
  cleanUrls: true,
  lastUpdated: true,
  rewrites: {
    "en/index.md": "index.md",
    "en/:path*": ":path*",
  },
  locales: {
    root: {
      label: "English",
      lang: "en-US",
      title: "nexu",
      description: "nexu documentation for channels, models, and skills.",
      link: "/",
    },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      title: "nexu",
      description: "nexu 的渠道、模型与技能文档。",
      link: "/zh/",
    },
    ja: {
      label: "日本語",
      lang: "ja",
      title: "nexu",
      description: "nexu のチャンネル、モデル、スキルに関するドキュメント。",
      link: "/ja/",
    },
  },
  head: [
    ["meta", { name: "theme-color", content: "#3DB9CE" }],
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    ["link", { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" }],
    ["script", {}, localePreferenceScript],
    ["link", { rel: "icon", href: "/favicon/favicon.ico", sizes: "any" }],
    [
      "link",
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon/favicon-light.svg",
        media: "(prefers-color-scheme: light)",
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/favicon/favicon-dark.svg",
        media: "(prefers-color-scheme: dark)",
      },
    ],
    [
      "link",
      { rel: "apple-touch-icon", href: "/favicon/apple-touch-icon.png" },
    ],
  ],
  themeConfig: {
    logo: {
      light: "/favicon/nexu-logo-light.svg",
      dark: "/favicon/nexu-logo-dark.svg",
      alt: "nexu",
    },
    siteTitle: false,
    socialLinks: [{ icon: "github", link: "https://github.com/nexu-io/nexu" }],
    langMenuLabel: "Language",
    search: {
      provider: "local",
      options: {
        locales: {
          root: {
            translations: {
              button: {
                buttonText: "Search docs",
                buttonAriaLabel: "Search docs",
              },
              modal: {
                noResultsText: "No results found",
                resetButtonTitle: "Clear search",
                footer: {
                  selectText: "to select",
                  navigateText: "to navigate",
                  closeText: "to close",
                },
              },
            },
          },
          zh: {
            translations: {
              button: {
                buttonText: "搜索文档",
                buttonAriaLabel: "搜索文档",
              },
              modal: {
                noResultsText: "未找到结果",
                resetButtonTitle: "清除搜索",
                footer: {
                  selectText: "选择",
                  navigateText: "切换",
                  closeText: "关闭",
                },
              },
            },
          },
          ja: {
            translations: {
              button: {
                buttonText: "ドキュメントを検索",
                buttonAriaLabel: "ドキュメントを検索",
              },
              modal: {
                noResultsText: "該当なし",
                resetButtonTitle: "検索をクリア",
                footer: {
                  selectText: "選択",
                  navigateText: "移動",
                  closeText: "閉じる",
                },
              },
            },
          },
        },
      },
    },
    outline: {
      label: "On this page",
    },
    docFooter: {
      prev: "Previous page",
      next: "Next page",
    },
    sidebar: {
      "/": enSidebar,
      "/zh/": zhSidebar,
      "/ja/": jaSidebar,
    },
  },
});
