import { defineConfig } from "vitepress";

const enSidebar = [
  {
    text: "Get Started",
    items: [
      { text: "Introduction", link: "/en/" },
      { text: "Channel Configuration", link: "/en/guide/channels" },
      { text: "Model Configuration", link: "/en/guide/models" },
      { text: "Skill Installation", link: "/en/guide/skills" },
    ],
  },
  {
    text: "Channel Guides",
    items: [
      { text: "Feishu", link: "/en/guide/channels/feishu" },
      { text: "Slack", link: "/en/guide/channels/slack" },
      { text: "Discord", link: "/en/guide/channels/discord" },
    ],
  },
];

const zhSidebar = [
  {
    text: "快速开始",
    items: [
      { text: "介绍", link: "/zh/" },
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
  head: [["meta", { name: "theme-color", content: "#c96f4a" }]],
  themeConfig: {
    logo: "/mark.png",
    socialLinks: [{ icon: "github", link: "https://github.com/refly-ai/nexu" }],
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
      "/en/": enSidebar,
      "/zh/": zhSidebar,
      "/": [
        {
          text: "Docs",
          items: [
            { text: "Introduction", link: "/" },
            { text: "English", link: "/en/" },
            { text: "简体中文", link: "/zh/" },
          ],
        },
      ],
    },
  },
});
