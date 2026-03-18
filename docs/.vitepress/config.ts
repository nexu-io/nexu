import { defineConfig } from "vitepress";

const enSidebar = [
  {
    text: "Get Started",
    items: [
      { text: "Introduction", link: "/" },
      { text: "Contributing", link: "/guide/contributing" },
      { text: "Channel Configuration", link: "/guide/channels" },
      { text: "Model Configuration", link: "/guide/models" },
      { text: "Skill Installation", link: "/guide/skills" },
    ],
  },
  {
    text: "Channel Guides",
    items: [
      { text: "Feishu", link: "/guide/channels/feishu" },
      { text: "Slack", link: "/guide/channels/slack" },
      { text: "Discord", link: "/guide/channels/discord" },
    ],
  },
];

const zhSidebar = [
  {
    text: "快速开始",
    items: [
      { text: "介绍", link: "/zh/" },
      { text: "参与贡献", link: "/zh/guide/contributing" },
      { text: "渠道配置", link: "/zh/guide/channels" },
      { text: "模型配置", link: "/zh/guide/models" },
      { text: "技能安装", link: "/zh/guide/skills" },
    ],
  },
  {
    text: "渠道指南",
    items: [
      { text: "飞书", link: "/zh/guide/channels/feishu" },
      { text: "Slack", link: "/zh/guide/channels/slack" },
      { text: "Discord", link: "/zh/guide/channels/discord" },
    ],
  },
];

export default defineConfig({
  title: "Nexu Docs",
  description: "Nexu documentation for channels, models, and skills.",
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
      title: "Nexu Docs",
      description: "Nexu documentation for channels, models, and skills.",
      link: "/",
    },
    zh: {
      label: "简体中文",
      lang: "zh-CN",
      title: "Nexu 文档",
      description: "Nexu 的渠道、模型与技能文档。",
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
    socialLinks: [{ icon: "github", link: "https://github.com/refly-ai/nexu" }],
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
