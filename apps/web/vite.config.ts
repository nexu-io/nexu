import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

process.env.VITE_COMMIT_HASH ??= "local-dev";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://localhost:3000",
      "/api": "http://localhost:3000",
      "/openapi.json": "http://localhost:3000",
    },
  },
});
