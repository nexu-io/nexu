import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";

const nexuWebRoot = resolve(__dirname, "../web");
const nexuWebSrc = resolve(nexuWebRoot, "src");

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: "main/bootstrap.ts",
        onstart(options) {
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
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      "@": nexuWebSrc,
      "@desktop": resolve(__dirname, "src"),
      "@shared": resolve(__dirname, "shared"),
    },
  },
  server: {
    port: 5180,
    fs: {
      allow: [resolve(__dirname, "../..")],
    },
    proxy: {
      "/v1": "http://127.0.0.1:50800",
      "/api": "http://127.0.0.1:50800",
      "/openapi.json": "http://127.0.0.1:50800",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
