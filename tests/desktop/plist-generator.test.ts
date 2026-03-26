import { describe, expect, it, vi } from "vitest";

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

    expect(controllerPlist).toContain(
      "<string>/Users/testuser/.nexu/logs/controller.log</string>",
    );
    expect(controllerPlist).toContain(
      "<string>/Users/testuser/.nexu/logs/controller.error.log</string>",
    );
    expect(openclawPlist).toContain(
      "<string>/Users/testuser/.nexu/logs/openclaw.log</string>",
    );
    expect(openclawPlist).toContain(
      "<string>/Users/testuser/.nexu/logs/openclaw.error.log</string>",
    );
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
});
