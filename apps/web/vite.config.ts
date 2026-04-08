import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

process.env.VITE_COMMIT_HASH ??= "local-dev";

const webHost = process.env.WEB_HOST ?? "127.0.0.1";
const webPort = Number.parseInt(process.env.WEB_PORT ?? "5173", 10);
const webApiOrigin = process.env.WEB_API_ORIGIN ?? "http://127.0.0.1:3010";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: webHost,
    port: webPort,
    strictPort: true,
    proxy: {
      "/v1": webApiOrigin,
      "/api": webApiOrigin,
      "/openapi.json": webApiOrigin,
    },
  },
});
