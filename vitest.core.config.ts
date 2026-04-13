import { defineConfig, mergeConfig } from "vitest/config";
import { vitestBaseConfig } from "./vitest.base";

export default mergeConfig(
  vitestBaseConfig,
  defineConfig({
    test: {
      fileParallelism: false,
      include: ["tests/**/*.test.{ts,tsx}"],
      exclude: [
        "tests/api/**",
        "tests/desktop/launchd-*.test.ts",
        "tests/desktop/update-server-integration.test.ts",
        "tests/desktop/skill-dir-watcher*.test.ts",
        "tests/desktop/daemon-supervisor*.test.ts",
        "tests/desktop/lifecycle-teardown.test.ts",
        "tests/extended/**/*.test.{ts,tsx}",
        "tests/**/*.extended.test.{ts,tsx}",
      ],
    },
  }),
);
