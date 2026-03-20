import ImageViewer from "@davidingplus/vitepress-image-viewer";
import type { Theme } from "vitepress";
import DefaultTheme from "vitepress/theme";
import "@davidingplus/vitepress-image-viewer/style.css";
import "./custom.css";

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp(ctx) {
    ImageViewer(ctx.app);
  },
};

export default theme;
