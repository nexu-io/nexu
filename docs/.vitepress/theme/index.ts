import ImageViewer from "@davidingplus/vitepress-image-viewer";
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "@davidingplus/vitepress-image-viewer/style.css";
import "./custom.css";
import { h } from "vue";
import GitHubStars from "./GitHubStars.vue";
import ThemeToggle from "./ThemeToggle.vue";
import LanguageSwitcher from "./LanguageSwitcher.vue";

const theme: Theme = {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "nav-bar-content-after": () => [
        h(LanguageSwitcher),
        h(ThemeToggle),
        h(GitHubStars),
      ],
    });
  },
  enhanceApp(ctx) {
    ImageViewer(ctx.app);
  },
};

export default theme;
