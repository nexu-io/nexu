const path = require("node:path");

const repoRoot = __dirname;
const openclawStateDir = path.join(repoRoot, ".openclaw");

module.exports = {
  apps: [
    {
      name: "openclaw",
      cwd: repoRoot,
      script: path.join(repoRoot, "openclaw-wrapper"),
      args: [
        "gateway",
        "run",
        "--allow-unconfigured",
        "--bind",
        "loopback",
        "--port",
        "18789",
        "--force",
        "--verbose",
      ],
      interpreter: "none",
      watch: false,
      autorestart: true,
      env: {
        OPENCLAW_STATE_DIR: openclawStateDir,
      },
    },
    {
      name: "nexu-gateway",
      cwd: repoRoot,
      script: "pnpm",
      args: ["--filter", "@nexu/gateway", "dev"],
      interpreter: "none",
      watch: false,
      autorestart: true,
      env: {
        OPENCLAW_STATE_DIR: openclawStateDir,
        RUNTIME_MANAGE_OPENCLAW_PROCESS: "false",
      },
    },
  ],
};
