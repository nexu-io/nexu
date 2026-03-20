import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    fileParallelism: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/api/**"],
  },
  resolve: {
    alias: {
      "#web": path.resolve(import.meta.dirname, "apps/web/src"),
      "#desktop": path.resolve(import.meta.dirname, "apps/desktop"),
      "#controller": path.resolve(import.meta.dirname, "apps/controller/src"),
      "@": path.resolve(import.meta.dirname, "apps/web/src"),
      "@web-gen": path.resolve(import.meta.dirname, "apps/web/lib"),
      react: path.resolve(import.meta.dirname, "apps/web/node_modules/react"),
      "react/jsx-runtime": path.resolve(
        import.meta.dirname,
        "apps/web/node_modules/react/jsx-runtime.js",
      ),
      "react/jsx-dev-runtime": path.resolve(
        import.meta.dirname,
        "apps/web/node_modules/react/jsx-dev-runtime.js",
      ),
      "react-dom": path.resolve(
        import.meta.dirname,
        "apps/web/node_modules/react-dom",
      ),
      "react-router-dom": path.resolve(
        import.meta.dirname,
        "apps/web/node_modules/react-router-dom",
      ),
      "@tanstack/react-query": path.resolve(
        import.meta.dirname,
        "apps/web/node_modules/@tanstack/react-query",
      ),
    },
    dedupe: ["react", "react-dom"],
  },
});
