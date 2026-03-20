import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Tests share a single postgres test DB and manage tables themselves.
    // Run files sequentially to prevent DROP/CREATE conflicts.
    fileParallelism: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/api/**"],
  },
  resolve: {
    alias: {
      "#api": path.resolve(import.meta.dirname, "apps/api/src"),
      "#gateway": path.resolve(import.meta.dirname, "apps/gateway/src"),
      "#web": path.resolve(import.meta.dirname, "apps/web/src"),
      "#desktop": path.resolve(import.meta.dirname, "apps/desktop"),
      "#controller": path.resolve(import.meta.dirname, "apps/controller/src"),
      "@": path.resolve(import.meta.dirname, "apps/web/src"),
      "@web-gen": path.resolve(import.meta.dirname, "apps/web/lib"),
    },
    dedupe: ["react", "react-dom"],
  },
});
