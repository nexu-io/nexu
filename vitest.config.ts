import { defineConfig } from "vitest/config";
import { vitestBaseConfig } from "./vitest.base";

export default defineConfig({
  ...vitestBaseConfig,
  test: {
    fileParallelism: false,
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/api/**"],
  },
});
