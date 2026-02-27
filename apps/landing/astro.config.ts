import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  integrations: [react()],
  vite: {
    // biome-ignore lint/suspicious/noExplicitAny: @tailwindcss/vite targets Vite 7, Astro 5 bundles Vite 6
    plugins: [tailwindcss() as any],
  },
  server: {
    port: 5174,
  },
});
