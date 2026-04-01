/**
 * Plist env var parity test — ensures the launchd plist path
 * includes ALL environment variables that the manifest/spawn path provides.
 *
 * This is the regression test for the "missing 13 env vars" bug.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/Users/testuser"),
}));

describe("controller plist env var parity with manifests", () => {
  const mockEnv = {
    isDev: false,
    logDir: "/Users/testuser/.nexu/logs",
    controllerPort: 50800,
    openclawPort: 18789,
    nodePath: "/usr/local/bin/node",
    controllerEntryPath: "/app/controller/dist/index.js",
    openclawPath: "/app/openclaw/openclaw.mjs",
    openclawConfigPath: "/Users/testuser/.nexu/openclaw.json",
    openclawStateDir: "/Users/testuser/.nexu/openclaw",
    controllerCwd: "/app/controller",
    openclawCwd: "/app",
    nexuHome: "/Users/testuser/.nexu",
    gatewayToken: "test-token-123",
    systemPath: "/usr/local/bin:/usr/bin",
    nodeModulesPath: "/app/node_modules",
    webUrl: "http://127.0.0.1:50810",
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

  /**
   * Critical env vars that the controller needs for correct operation.
   * Each entry documents WHY it's needed so removals are deliberate.
   */
  const REQUIRED_CONTROLLER_ENV_KEYS = [
    // Core process identity
    "ELECTRON_RUN_AS_NODE",
    "NODE_ENV",
    "HOME",
    // Network binding
    "PORT",
    "HOST",
    // OpenClaw integration
    "OPENCLAW_GATEWAY_PORT",
    "OPENCLAW_STATE_DIR",
    "OPENCLAW_CONFIG_PATH",
    "OPENCLAW_SKILLS_DIR",
    "OPENCLAW_BIN",
    "OPENCLAW_ELECTRON_EXECUTABLE",
    "OPENCLAW_EXTENSIONS_DIR",
    "OPENCLAW_GATEWAY_TOKEN",
    "OPENCLAW_DISABLE_BONJOUR",
    // Controller-specific
    "WEB_URL",
    "SKILLHUB_STATIC_SKILLS_DIR",
    "PLATFORM_TEMPLATES_DIR",
    "NODE_PATH",
    "TMPDIR",
    "NEXU_HOME",
    "PATH",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "NODE_USE_ENV_PROXY",
    // Runtime control
    "RUNTIME_MANAGE_OPENCLAW_PROCESS",
    "RUNTIME_GATEWAY_PROBE_ENABLED",
  ];

  it("controller plist contains all required env vars", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const plist = generatePlist("controller", mockEnv);

    for (const key of REQUIRED_CONTROLLER_ENV_KEYS) {
      expect(plist, `missing env var: ${key}`).toContain(`<key>${key}</key>`);
    }
  });

  it("controller plist env var values are correct", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const plist = generatePlist("controller", mockEnv);

    // Verify critical values (not just presence)
    expect(plist).toContain(
      "<key>HOST</key>\n        <string>127.0.0.1</string>",
    );
    expect(plist).toContain(
      "<key>RUNTIME_MANAGE_OPENCLAW_PROCESS</key>\n        <string>false</string>",
    );
    expect(plist).toContain(
      "<key>RUNTIME_GATEWAY_PROBE_ENABLED</key>\n        <string>false</string>",
    );
    expect(plist).toContain(
      "<key>OPENCLAW_DISABLE_BONJOUR</key>\n        <string>1</string>",
    );
    expect(plist).toContain(
      `<key>WEB_URL</key>\n        <string>${mockEnv.webUrl}</string>`,
    );
    expect(plist).toContain(
      `<key>OPENCLAW_CONFIG_PATH</key>\n        <string>${mockEnv.openclawConfigPath}</string>`,
    );
    expect(plist).toContain(
      `<key>NODE_PATH</key>\n        <string>${mockEnv.skillNodePath}</string>`,
    );
  });

  it("optional env vars are omitted when not provided", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const minimalEnv = {
      ...mockEnv,
      nexuHome: undefined,
      gatewayToken: undefined,
      systemPath: undefined,
    };

    const plist = generatePlist("controller", minimalEnv);

    expect(plist).not.toContain("<key>NEXU_HOME</key>");
    expect(plist).not.toContain("<key>OPENCLAW_GATEWAY_TOKEN</key>");
    expect(plist).not.toContain("<key>PATH</key>");
    // Required vars should still be present
    expect(plist).toContain("<key>PORT</key>");
    expect(plist).toContain("<key>OPENCLAW_CONFIG_PATH</key>");
  });

  it("openclaw plist has required env vars", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const plist = generatePlist("openclaw", mockEnv);

    const REQUIRED_OPENCLAW_KEYS = [
      "ELECTRON_RUN_AS_NODE",
      "OPENCLAW_CONFIG",
      "OPENCLAW_CONFIG_PATH",
      "OPENCLAW_STATE_DIR",
      "OPENCLAW_LAUNCHD_LABEL",
      "OPENCLAW_SERVICE_MARKER",
      "HOME",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "NO_PROXY",
      "NODE_USE_ENV_PROXY",
    ];

    for (const key of REQUIRED_OPENCLAW_KEYS) {
      expect(plist, `missing openclaw env var: ${key}`).toContain(
        `<key>${key}</key>`,
      );
    }

    if (mockEnv.gatewayToken) {
      expect(
        plist,
        "openclaw plist must include OPENCLAW_GATEWAY_TOKEN when gatewayToken is set",
      ).toContain("<key>OPENCLAW_GATEWAY_TOKEN</key>");
    }
  });

  it("gateway token is present in BOTH controller and openclaw plists", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const envWithToken = { ...mockEnv, gatewayToken: "parity-test-token" };
    const controllerPlist = generatePlist("controller", envWithToken);
    const openclawPlist = generatePlist("openclaw", envWithToken);

    expect(controllerPlist).toContain("<key>OPENCLAW_GATEWAY_TOKEN</key>");
    expect(controllerPlist).toContain("<string>parity-test-token</string>");
    expect(openclawPlist).toContain("<key>OPENCLAW_GATEWAY_TOKEN</key>");
    expect(openclawPlist).toContain("<string>parity-test-token</string>");
  });

  it("dev mode sets NODE_ENV=development and adds --auth none to openclaw", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const devEnv = { ...mockEnv, isDev: true };

    const controllerPlist = generatePlist("controller", devEnv);
    const openclawPlist = generatePlist("openclaw", devEnv);

    expect(controllerPlist).toContain(
      "<key>NODE_ENV</key>\n        <string>development</string>",
    );
    expect(openclawPlist).toContain("<string>--auth</string>");
    expect(openclawPlist).toContain("<string>none</string>");
  });

  it("prod mode sets NODE_ENV=production and no --auth none", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );

    const controllerPlist = generatePlist("controller", mockEnv);
    const openclawPlist = generatePlist("openclaw", mockEnv);

    expect(controllerPlist).toContain(
      "<key>NODE_ENV</key>\n        <string>production</string>",
    );
    expect(openclawPlist).not.toContain("<string>--auth</string>");
  });
});
