import ImageViewer from "@davidingplus/vitepress-image-viewer";
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "@davidingplus/vitepress-image-viewer/style.css";
import "./custom.css";
import { h } from "vue";
import GitHubStars from "./GitHubStars.vue";

const theme: Theme = {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "nav-bar-content-after": () => [
        h(GitHubStars),
      ],
    });
  },
  enhanceApp(ctx) {
    ImageViewer(ctx.app);
  },
};

export default theme;
