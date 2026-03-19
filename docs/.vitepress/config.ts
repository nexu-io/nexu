import { defineConfig } from "vitepress";

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
          { text: "Feishu", link: "/guide/channels/feishu" },
          { text: "Slack", link: "/guide/channels/slack" },
          { text: "Discord", link: "/guide/channels/discord" },
        ],
      },
      { text: "Model Configuration", link: "/guide/models" },
      { text: "Skill Installation", link: "/guide/skills" },
    ],
  },
  {
    text: "Community",
    items: [
      { text: "Contributing", link: "/guide/contributing" },
      { text: "Contact Us", link: "/guide/contact" },
      { text: "Changelog", link: "https://github.com/nexu-io/nexu/releases" },
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
          { text: "飞书", link: "/zh/guide/channels/feishu" },
          { text: "Slack", link: "/zh/guide/channels/slack" },
          { text: "Discord", link: "/zh/guide/channels/discord" },
        ],
      },
      { text: "模型配置", link: "/zh/guide/models" },
      { text: "技能安装", link: "/zh/guide/skills" },
    ],
  },
  {
    text: "社区",
    items: [
      { text: "参与贡献", link: "/zh/guide/contributing" },
      { text: "联系我们", link: "/zh/guide/contact" },
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
  },
  head: [
    ["meta", { name: "theme-color", content: "#c96f4a" }],
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
      light: "/favicon/favicon-light.svg",
      dark: "/favicon/favicon-dark.svg",
      alt: "Nexu",
    },
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
    },
  },
});
