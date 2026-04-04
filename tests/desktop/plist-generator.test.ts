import { describe, expect, it, vi } from "vitest";

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/Users/testuser"),
}));

describe("generatePlist", () => {
  const mockEnv = {
    isDev: false,
    logDir: "/Users/testuser/.nexu/logs",
    controllerPort: 50800,
    openclawPort: 18789,
    nodePath: "/usr/local/bin/node",
    controllerEntryPath: "/app/controller/dist/index.js",
    openclawPath: "/app/openclaw/openclaw.mjs",
    openclawConfigPath: "/Users/testuser/.nexu/openclaw.yaml",
    openclawStateDir: "/Users/testuser/.nexu/openclaw",
    controllerCwd: "/app/controller",
    openclawCwd: "/app",
    webUrl: "http://127.0.0.1:50801",
    openclawSkillsDir: "/Users/testuser/.nexu/openclaw/state/skills",
    skillhubStaticSkillsDir: "/app/static/bundled-skills",
    platformTemplatesDir: "/app/static/platform-templates",
    openclawBinPath: "/app/openclaw/bin/openclaw",
    openclawExtensionsDir: "/app/node_modules/openclaw/extensions",
    skillNodePath: "/app/bundled-node-modules",
    openclawTmpDir: "/Users/testuser/.nexu/openclaw/tmp",
    proxyEnv: {
      HTTP_PROXY: "http://proxy.example.com:8080",
      HTTPS_PROXY: "http://secure-proxy.example.com:8443",
      ALL_PROXY: "socks5://proxy.example.com:1080",
      NO_PROXY: "example.com,localhost,127.0.0.1,::1",
      NODE_USE_ENV_PROXY: "1",
    },
  };

  it("generates valid controller plist XML", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const plist = generatePlist("controller", mockEnv);

    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain("<string>io.nexu.controller</string>");
    expect(plist).toContain("<string>/usr/local/bin/node</string>");
    expect(plist).toContain("<string>/app/controller/dist/index.js</string>");
    expect(plist).toContain("<key>PORT</key>");
    expect(plist).toContain("<string>50800</string>");
    expect(plist).toContain("<key>KeepAlive</key>");
  });

  it("generates valid openclaw plist XML", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const plist = generatePlist("openclaw", mockEnv);

    expect(plist).toContain("<string>io.nexu.openclaw</string>");
    expect(plist).toContain("<string>/app/openclaw/openclaw.mjs</string>");
    expect(plist).toContain("<string>gateway</string>");
    expect(plist).toContain("<string>run</string>");
    expect(plist).toContain("<key>OPENCLAW_CONFIG</key>");
    // Check OPENCLAW_CONFIG_PATH env var (not --config argument)
    expect(plist).toContain("<key>OPENCLAW_CONFIG_PATH</key>");
    expect(plist).toContain("<key>OPENCLAW_STATE_DIR</key>");
    expect(plist).toContain("<key>OPENCLAW_LAUNCHD_LABEL</key>");
    expect(plist).toContain("<key>OPENCLAW_SERVICE_MARKER</key>");
    expect(plist).toContain("<string>launchd</string>");
    // Should NOT use --config argument
    expect(plist).not.toContain("--config");
    // Check dependency on controller
    expect(plist).toContain("<key>OtherJobEnabled</key>");
    expect(plist).toContain("<key>io.nexu.controller</key>");
  });

  it("uses dev labels when isDev is true", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const devEnv = { ...mockEnv, isDev: true };

    const controllerPlist = generatePlist("controller", devEnv);
    const openclawPlist = generatePlist("openclaw", devEnv);

    expect(controllerPlist).toContain(
      "<string>io.nexu.controller.dev</string>",
    );
    expect(openclawPlist).toContain("<string>io.nexu.openclaw.dev</string>");
    // OpenClaw should depend on dev controller
    expect(openclawPlist).toContain("<key>io.nexu.controller.dev</key>");
  });

  it("escapes XML special characters", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const envWithSpecialChars = {
      ...mockEnv,
      controllerEntryPath: "/path/with<special>&chars.js",
    };

    const plist = generatePlist("controller", envWithSpecialChars);

    expect(plist).toContain("&lt;special&gt;&amp;chars.js");
    expect(plist).not.toContain("<special>");
  });

  it("sets correct log paths", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const controllerPlist = generatePlist("controller", mockEnv);
    const openclawPlist = generatePlist("openclaw", mockEnv);

    expect(normalizePath(controllerPlist)).toContain(
      "<string>/Users/testuser/.nexu/logs/controller.log</string>",
    );
    expect(normalizePath(controllerPlist)).toContain(
      "<string>/Users/testuser/.nexu/logs/controller.error.log</string>",
    );
    expect(normalizePath(openclawPlist)).toContain(
      "<string>/Users/testuser/.nexu/logs/openclaw.log</string>",
    );
    expect(normalizePath(openclawPlist)).toContain(
      "<string>/Users/testuser/.nexu/logs/openclaw.error.log</string>",
    );
  });

  it("renders PostHog analytics env vars when configured", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const plist = generatePlist("controller", {
      ...mockEnv,
      posthogApiKey: "phc_test_key",
      posthogHost: "https://us.i.posthog.com",
    });

    expect(plist).toContain("<key>POSTHOG_API_KEY</key>");
    expect(plist).toContain("<string>phc_test_key</string>");
    expect(plist).toContain("<key>POSTHOG_HOST</key>");
    expect(plist).toContain("<string>https://us.i.posthog.com</string>");
  });

  // -----------------------------------------------------------------------
  // ProgramArguments ordering — controller
  // -----------------------------------------------------------------------
  it("controller ProgramArguments: [nodePath, controllerEntryPath] in exact order", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("controller", mockEnv);

    // Extract ProgramArguments array content
    const argsMatch = plist.match(
      /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/,
    );
    expect(argsMatch).not.toBeNull();
    const argsBlock = argsMatch?.[1] ?? "";
    const strings = [...argsBlock.matchAll(/<string>([^<]*)<\/string>/g)].map(
      (m) => m[1],
    );
    expect(strings).toEqual([
      "/usr/local/bin/node",
      "/app/controller/dist/index.js",
    ]);
  });

  // -----------------------------------------------------------------------
  // ProgramArguments ordering — openclaw
  // -----------------------------------------------------------------------
  it("openclaw ProgramArguments: [nodePath, openclawPath, gateway, run] in exact order", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("openclaw", mockEnv);

    const argsMatch = plist.match(
      /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/,
    );
    expect(argsMatch).not.toBeNull();
    const argsBlock = argsMatch?.[1] ?? "";
    const strings = [...argsBlock.matchAll(/<string>([^<]*)<\/string>/g)].map(
      (m) => m[1],
    );
    expect(strings).toEqual([
      "/usr/local/bin/node",
      "/app/openclaw/openclaw.mjs",
      "gateway",
      "run",
      "--port",
      String(mockEnv.openclawPort),
    ]);
  });

  it("openclaw dev mode inserts --auth none after gateway run", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("openclaw", { ...mockEnv, isDev: true });

    const argsMatch = plist.match(
      /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/,
    );
    expect(argsMatch).not.toBeNull();
    const argsBlock = argsMatch?.[1] ?? "";
    const strings = [...argsBlock.matchAll(/<string>([^<]*)<\/string>/g)].map(
      (m) => m[1],
    );
    expect(strings).toEqual([
      "/usr/local/bin/node",
      "/app/openclaw/openclaw.mjs",
      "gateway",
      "run",
      "--port",
      String(mockEnv.openclawPort),
      "--auth",
      "none",
    ]);
  });

  // -----------------------------------------------------------------------
  // Openclaw plist completeness — WorkingDirectory, error log, KeepAlive
  // -----------------------------------------------------------------------
  it("openclaw plist has correct WorkingDirectory", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("openclaw", mockEnv);

    expect(normalizePath(plist)).toContain(
      "<key>WorkingDirectory</key>\n    <string>/app</string>",
    );
  });

  it("openclaw plist has StandardErrorPath", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("openclaw", mockEnv);

    expect(normalizePath(plist)).toContain(
      "<string>/Users/testuser/.nexu/logs/openclaw.error.log</string>",
    );
  });

  it("openclaw plist KeepAlive restarts on non-zero exit", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("openclaw", mockEnv);

    // SuccessfulExit=false means launchd restarts when exit code != 0
    expect(plist).toContain("<key>SuccessfulExit</key>");
    expect(plist).toMatch(/<key>SuccessfulExit<\/key>\s*<false\/>/);
  });

  it("openclaw plist has ThrottleInterval to prevent rapid respawn", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("openclaw", mockEnv);

    expect(plist).toContain("<key>ThrottleInterval</key>");
    expect(plist).toMatch(
      /<key>ThrottleInterval<\/key>\s*<integer>\d+<\/integer>/,
    );
  });

  it("controller plist has correct WorkingDirectory", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("controller", mockEnv);

    expect(normalizePath(plist)).toContain(
      "<key>WorkingDirectory</key>\n    <string>/app/controller</string>",
    );
  });

  it("both plists have RunAtLoad=false (explicit start only)", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const controller = generatePlist("controller", mockEnv);
    const openclaw = generatePlist("openclaw", mockEnv);

    expect(controller).toMatch(/<key>RunAtLoad<\/key>\s*<false\/>/);
    expect(openclaw).toMatch(/<key>RunAtLoad<\/key>\s*<false\/>/);
  });

  // -----------------------------------------------------------------------
  // XML escaping robustness
  // -----------------------------------------------------------------------
  it("escapes ampersand, angle brackets, quotes, and apostrophes in all path fields", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const nastEnv = {
      ...mockEnv,
      nodePath: "/usr/bin/node's",
      controllerCwd: '/app/"controller"',
      openclawPath: "/path/with&special<chars>.mjs",
      openclawConfigPath: "/Users/test'user/.nexu/config",
    };

    const controller = generatePlist("controller", nastEnv);
    const openclaw = generatePlist("openclaw", nastEnv);

    // Verify escaped forms present, raw forms absent
    expect(controller).toContain("node&apos;s");
    expect(controller).not.toContain("node's</string>");
    expect(controller).toContain("&quot;controller&quot;");
    expect(openclaw).toContain("&amp;special&lt;chars&gt;");
    expect(openclaw).toContain("test&apos;user");
  });

  it("sets ELECTRON_RUN_AS_NODE=1 for both services", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const controllerPlist = generatePlist("controller", mockEnv);
    const openclawPlist = generatePlist("openclaw", mockEnv);

    // Both services should use ELECTRON_RUN_AS_NODE=1 to run as pure Node.js
    expect(controllerPlist).toContain("<key>ELECTRON_RUN_AS_NODE</key>");
    expect(controllerPlist).toContain(
      "<key>ELECTRON_RUN_AS_NODE</key>\n        <string>1</string>",
    );
    expect(openclawPlist).toContain("<key>ELECTRON_RUN_AS_NODE</key>");
    expect(openclawPlist).toContain(
      "<key>ELECTRON_RUN_AS_NODE</key>\n        <string>1</string>",
    );
  });

  it("includes normalized proxy env vars in controller and openclaw plists", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const controllerPlist = generatePlist("controller", mockEnv);
    const openclawPlist = generatePlist("openclaw", mockEnv);

    for (const plist of [controllerPlist, openclawPlist]) {
      expect(plist).toContain("<key>HTTP_PROXY</key>");
      expect(plist).toContain("<key>HTTPS_PROXY</key>");
      expect(plist).toContain("<key>ALL_PROXY</key>");
      expect(plist).toContain("<key>NO_PROXY</key>");
      expect(plist).toContain("<key>NODE_USE_ENV_PROXY</key>");
      expect(plist).toContain("example.com,localhost,127.0.0.1,::1");
    }
  });
});
