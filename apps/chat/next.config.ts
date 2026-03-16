import { resolve } from "node:path";
import type { NextConfig } from "next";

const repoRoot = resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
  },
};

export default nextConfig;
