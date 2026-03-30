import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type PluginOption, defineConfig } from "vite";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";

const nexuWebRoot = resolve(__dirname, "../web");
const nexuWebSrc = resolve(nexuWebRoot, "src");
const desktopDevHost = process.env.NEXU_DESKTOP_DEV_HOST ?? "127.0.0.1";
const desktopDevPort = Number.parseInt(
  process.env.NEXU_DESKTOP_DEV_PORT ?? "5180",
  10,
);
const desktopDevApiOrigin =
  process.env.NEXU_DESKTOP_DEV_API_ORIGIN ?? "http://127.0.0.1:3010";
const disableImplicitElectronStartup =
  process.env.NEXU_DESKTOP_DISABLE_VITE_ELECTRON_STARTUP === "1";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: "main/bootstrap.ts",
        onstart(options) {
          if (disableImplicitElectronStartup) {
            return;
          }

          options.startup();
        },
        vite: {
          build: {
            target: "esnext",
            outDir: "dist-electron/main",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      {
        entry: "preload/index.ts",
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            sourcemap: true,
            outDir: "dist-electron/preload",
            rollupOptions: {
              external: ["electron"],
              output: {
                format: "cjs",
              },
            },
          },
        },
      },
      {
        entry: "preload/webview-preload.ts",
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            sourcemap: true,
            outDir: "dist-electron/preload",
            rollupOptions: {
              external: ["electron"],
              output: {
                format: "cjs",
              },
            },
          },
        },
      },
    ]) as PluginOption,
    renderer() as PluginOption,
  ],
  resolve: {
    alias: {
      "@": nexuWebSrc,
      "@desktop": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "shared"),
    },
  },
  server: {
    host: desktopDevHost,
    port: desktopDevPort,
    strictPort: true,
    fs: {
      allow: [resolve(__dirname, "../..")],
    },
    proxy: {
      "/v1": desktopDevApiOrigin,
      "/api": desktopDevApiOrigin,
      "/openapi.json": desktopDevApiOrigin,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
