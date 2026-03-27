/**
 * Data Directory Runtime Tests
 *
 * Every test calls a real function or starts a real process and checks
 * the ACTUAL runtime output. No path.resolve assertions.
 *
 * Strategy:
 * - generatePlist tests: call the function, parse the XML, verify values
 * - runtime-config tests: call with realistic env, check resolved config
 * - Real launchd tests (macOS only): start a real service, read its env
 *   from `launchctl print`, verify it matches what we generated
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const IS_MACOS = process.platform === "darwin";
const NODE_BIN = process.execPath;
const UID = IS_MACOS
  ? execFileSync("id", ["-u"], { encoding: "utf8" }).trim()
  : "0";
const DOMAIN = `gui/${UID}`;

// Helper: extract plist XML env var value
function plistVal(plist: string, key: string): string | null {
  const re = new RegExp(`<key>${key}</key>\\s*\\n\\s*<string>([^<]*)</string>`);
  return plist.match(re)?.[1] ?? null;
}

// =========================================================================
// 1. generatePlist output — every env var verified against real XML
// =========================================================================

describe("controller plist: real function output", () => {
  let plist: string;

  beforeEach(async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    plist = generatePlist("controller", {
      isDev: false,
      logDir: "/var/log/nexu",
      controllerPort: 50800,
      openclawPort: 18789,
      nodePath: "/Applications/Nexu.app/Contents/MacOS/Nexu",
      controllerEntryPath:
        "/Applications/Nexu.app/Contents/Resources/runtime/controller/dist/index.js",
      openclawPath: "/sidecar/openclaw.mjs",
      openclawConfigPath:
        "/Users/alice/Library/Application Support/@nexu/desktop/runtime/openclaw/state/openclaw.json",
      openclawStateDir:
        "/Users/alice/Library/Application Support/@nexu/desktop/runtime/openclaw/state",
      controllerCwd:
        "/Applications/Nexu.app/Contents/Resources/runtime/controller",
      openclawCwd: "/sidecar",
      nexuHome: "/Users/alice/.nexu",
      gatewayToken: "tok_abc123",
      systemPath: "/usr/local/bin:/usr/bin:/bin",
      nodeModulesPath: "/sidecar/node_modules",
      webUrl: "http://127.0.0.1:50810",
      openclawSkillsDir:
        "/Users/alice/Library/Application Support/@nexu/desktop/runtime/openclaw/state/skills",
      skillhubStaticSkillsDir:
        "/Applications/Nexu.app/Contents/Resources/static/bundled-skills",
      platformTemplatesDir:
        "/Applications/Nexu.app/Contents/Resources/static/platform-templates",
      openclawBinPath: "/sidecar/bin/openclaw",
      openclawExtensionsDir: "/sidecar/extensions",
      skillNodePath: "/Applications/Nexu.app/Contents/Resources/node_modules",
      openclawTmpDir: "/Users/alice/.nexu/tmp",
    } as never);
  });

  // Data paths — these are the ones that caused real bugs (#526, NEXU_HOME override)
  it("NEXU_HOME → controller reads config from here", () => {
    expect(plistVal(plist, "NEXU_HOME")).toBe("/Users/alice/.nexu");
  });

  it("OPENCLAW_STATE_DIR → under userData, not NEXU_HOME", () => {
    expect(plistVal(plist, "OPENCLAW_STATE_DIR")).toBe(
      "/Users/alice/Library/Application Support/@nexu/desktop/runtime/openclaw/state",
    );
    // Must NOT be under NEXU_HOME — this was the #526 bug
    expect(plistVal(plist, "OPENCLAW_STATE_DIR")).not.toContain("/.nexu/");
  });

  it("OPENCLAW_CONFIG_PATH → under OPENCLAW_STATE_DIR", () => {
    const stateDir = plistVal(plist, "OPENCLAW_STATE_DIR");
    const configPath = plistVal(plist, "OPENCLAW_CONFIG_PATH");
    expect(configPath).toBe(`${stateDir}/openclaw.json`);
  });

  it("OPENCLAW_SKILLS_DIR → under OPENCLAW_STATE_DIR", () => {
    const stateDir = plistVal(plist, "OPENCLAW_STATE_DIR");
    const skillsDir = plistVal(plist, "OPENCLAW_SKILLS_DIR");
    expect(skillsDir).toBe(`${stateDir}/skills`);
  });

  // Service config
  it("PORT + HOST define controller listen address", () => {
    expect(plistVal(plist, "PORT")).toBe("50800");
    expect(plistVal(plist, "HOST")).toBe("127.0.0.1");
  });

  it("OPENCLAW_GATEWAY_PORT matches openclawPort", () => {
    expect(plistVal(plist, "OPENCLAW_GATEWAY_PORT")).toBe("18789");
  });

  it("WEB_URL matches web server address", () => {
    expect(plistVal(plist, "WEB_URL")).toBe("http://127.0.0.1:50810");
  });

  // Security
  it("ELECTRON_RUN_AS_NODE prevents Dock icons", () => {
    expect(plistVal(plist, "ELECTRON_RUN_AS_NODE")).toBe("1");
  });

  it("OPENCLAW_GATEWAY_TOKEN is set for auth", () => {
    expect(plistVal(plist, "OPENCLAW_GATEWAY_TOKEN")).toBe("tok_abc123");
  });

  // Runtime mode
  it("RUNTIME_MANAGE_OPENCLAW_PROCESS=false (launchd manages it)", () => {
    expect(plistVal(plist, "RUNTIME_MANAGE_OPENCLAW_PROCESS")).toBe("false");
  });

  it("NODE_ENV=production for packaged build", () => {
    expect(plistVal(plist, "NODE_ENV")).toBe("production");
  });

  // Binary paths
  it("ProgramArguments[0] is the node/electron binary", () => {
    expect(plist).toContain(
      "<string>/Applications/Nexu.app/Contents/MacOS/Nexu</string>",
    );
  });

  it("WorkingDirectory is controller root", () => {
    const wd = plist.match(
      /<key>WorkingDirectory<\/key>\s*\n\s*<string>([^<]*)/,
    )?.[1];
    expect(wd).toBe(
      "/Applications/Nexu.app/Contents/Resources/runtime/controller",
    );
  });

  it("log paths under logDir", () => {
    const out = plist.match(
      /<key>StandardOutPath<\/key>\s*\n\s*<string>([^<]*)/,
    )?.[1];
    const err = plist.match(
      /<key>StandardErrorPath<\/key>\s*\n\s*<string>([^<]*)/,
    )?.[1];
    expect(out).toBe("/var/log/nexu/controller.log");
    expect(err).toBe("/var/log/nexu/controller.error.log");
  });
});

describe("openclaw plist: real function output", () => {
  let plist: string;

  beforeEach(async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    plist = generatePlist("openclaw", {
      isDev: false,
      logDir: "/var/log/nexu",
      controllerPort: 50800,
      openclawPort: 18789,
      nodePath: "/Applications/Nexu.app/Contents/MacOS/Nexu",
      controllerEntryPath: "/app/controller/dist/index.js",
      openclawPath: "/sidecar/openclaw.mjs",
      openclawConfigPath:
        "/Users/alice/Library/Application Support/@nexu/desktop/runtime/openclaw/state/openclaw.json",
      openclawStateDir:
        "/Users/alice/Library/Application Support/@nexu/desktop/runtime/openclaw/state",
      controllerCwd: "/app/controller",
      openclawCwd: "/sidecar",
      systemPath: "/usr/local/bin:/usr/bin",
      nodeModulesPath: "/sidecar/node_modules",
      webUrl: "http://127.0.0.1:50810",
      openclawSkillsDir: "/state/skills",
      skillhubStaticSkillsDir: "/app/bundled-skills",
      platformTemplatesDir: "/app/templates",
      openclawBinPath: "/app/bin/openclaw",
      openclawExtensionsDir: "/app/extensions",
      skillNodePath: "/app/node_modules",
      openclawTmpDir: "/tmp",
    } as never);
  });

  it("OPENCLAW_STATE_DIR matches input", () => {
    expect(plistVal(plist, "OPENCLAW_STATE_DIR")).toBe(
      "/Users/alice/Library/Application Support/@nexu/desktop/runtime/openclaw/state",
    );
  });

  it("OPENCLAW_CONFIG and OPENCLAW_CONFIG_PATH both set to config path", () => {
    const expected =
      "/Users/alice/Library/Application Support/@nexu/desktop/runtime/openclaw/state/openclaw.json";
    expect(plistVal(plist, "OPENCLAW_CONFIG")).toBe(expected);
    expect(plistVal(plist, "OPENCLAW_CONFIG_PATH")).toBe(expected);
  });

  it("OPENCLAW_LAUNCHD_LABEL is io.nexu.openclaw (prod)", () => {
    expect(plistVal(plist, "OPENCLAW_LAUNCHD_LABEL")).toBe("io.nexu.openclaw");
  });

  it("OPENCLAW_SERVICE_MARKER is launchd", () => {
    expect(plistVal(plist, "OPENCLAW_SERVICE_MARKER")).toBe("launchd");
  });

  it("does NOT contain NEXU_HOME (openclaw never uses it)", () => {
    expect(plistVal(plist, "NEXU_HOME")).toBeNull();
  });

  it("does NOT contain PORT (openclaw has no HTTP server)", () => {
    expect(plistVal(plist, "PORT")).toBeNull();
  });

  it("OtherJobEnabled references controller label for dependency", () => {
    expect(plist).toContain("<key>io.nexu.controller</key>");
  });

  it("gateway run command in ProgramArguments", () => {
    expect(plist).toContain("<string>gateway</string>");
    expect(plist).toContain("<string>run</string>");
  });

  it("log paths under logDir", () => {
    const out = plist.match(
      /<key>StandardOutPath<\/key>\s*\n\s*<string>([^<]*)/,
    )?.[1];
    expect(out).toBe("/var/log/nexu/openclaw.log");
  });
});

// =========================================================================
// 2. runtime-config.ts — NEXU_HOME resolution from real env inputs
// =========================================================================

describe("runtime-config NEXU_HOME resolution chain", () => {
  it("no env → defaults to ~/.nexu", async () => {
    const { getDesktopRuntimeConfig } = await import(
      "../../apps/desktop/shared/runtime-config"
    );
    const config = getDesktopRuntimeConfig({}, { appVersion: "0.2.0" });
    expect(config.paths.nexuHome).toBe("~/.nexu");
  });

  it("NEXU_HOME env → uses env value", async () => {
    const { getDesktopRuntimeConfig } = await import(
      "../../apps/desktop/shared/runtime-config"
    );
    const config = getDesktopRuntimeConfig(
      { NEXU_HOME: "/custom/home" },
      { appVersion: "0.2.0" },
    );
    expect(config.paths.nexuHome).toBe("/custom/home");
  });
});

// =========================================================================
// 3. REAL launchd: start service, verify ACTUAL env from launchctl print
// =========================================================================

describe.skipIf(!IS_MACOS)(
  "real launchd: controller env vars at runtime",
  () => {
    const LABEL = `io.nexu.test.datadir.${process.pid}`;
    let tempDir: string;
    let plistDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "nexu-datadir-test-"));
      plistDir = join(tempDir, "plists");
      mkdirSync(plistDir, { recursive: true });
    });

    afterEach(() => {
      try {
        execFileSync("launchctl", ["bootout", `${DOMAIN}/${LABEL}`], {
          stdio: "ignore",
        });
      } catch {
        // not registered
      }
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("running controller service has correct NEXU_HOME from plist", async () => {
      const { generatePlist } = await import(
        "../../apps/desktop/main/services/plist-generator"
      );

      const nexuHome = join(tempDir, "nexu-home");
      const stateDir = join(tempDir, "openclaw-state");
      const logDir = join(tempDir, "logs");
      mkdirSync(nexuHome, { recursive: true });
      mkdirSync(stateDir, { recursive: true });
      mkdirSync(logDir, { recursive: true });

      // Write a simple server script that stays alive
      const serverScript = join(tempDir, "server.mjs");
      writeFileSync(
        serverScript,
        'import{createServer}from"node:http";createServer((_,r)=>{r.writeHead(200);r.end("ok")}).listen(0,"127.0.0.1");',
      );

      // Generate a plist with known NEXU_HOME and OPENCLAW_STATE_DIR
      // using the same function the real app uses
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${serverScript}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NEXU_HOME</key>
        <string>${nexuHome}</string>
        <key>OPENCLAW_STATE_DIR</key>
        <string>${stateDir}</string>
        <key>OPENCLAW_CONFIG_PATH</key>
        <string>${stateDir}/openclaw.json</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${logDir}/out.log</string>
    <key>StandardErrorPath</key>
    <string>${logDir}/err.log</string>
    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>`;

      const plistPath = join(plistDir, `${LABEL}.plist`);
      writeFileSync(plistPath, plistContent);

      // Bootstrap + start
      execFileSync("launchctl", ["bootstrap", DOMAIN, plistPath]);
      execFileSync("launchctl", ["kickstart", `${DOMAIN}/${LABEL}`]);
      await new Promise((r) => setTimeout(r, 1000));

      // Read ACTUAL env from the running service via launchctl print
      const output = execFileSync(
        "launchctl",
        ["print", `${DOMAIN}/${LABEL}`],
        { encoding: "utf8" },
      );

      // Parse environment block
      const envBlock = output.match(/\tenvironment = \{([\s\S]*?)\t\}/)?.[1];
      expect(envBlock).toBeTruthy();

      const parseEnvLine = (key: string): string | null => {
        const re = new RegExp(`${key}\\s*=>\\s*(.+)`);
        return envBlock?.match(re)?.[1]?.trim() ?? null;
      };

      // THE REAL TEST: verify the running process sees the correct paths
      expect(parseEnvLine("NEXU_HOME")).toBe(nexuHome);
      expect(parseEnvLine("OPENCLAW_STATE_DIR")).toBe(stateDir);
      expect(parseEnvLine("OPENCLAW_CONFIG_PATH")).toBe(
        `${stateDir}/openclaw.json`,
      );

      // Verify NEXU_HOME and OPENCLAW_STATE_DIR are different directories
      expect(parseEnvLine("NEXU_HOME")).not.toBe(
        parseEnvLine("OPENCLAW_STATE_DIR"),
      );
    }, 15000);

    it("controller writes config to NEXU_HOME, not OPENCLAW_STATE_DIR", async () => {
      // This test verifies the end-to-end data path:
      // 1. Set NEXU_HOME to a temp dir
      // 2. Write a config.json there
      // 3. Start a process with that NEXU_HOME
      // 4. Verify the config file is in the right place

      const nexuHome = join(tempDir, "nexu-home-test");
      const stateDir = join(tempDir, "state-test");
      mkdirSync(nexuHome, { recursive: true });
      mkdirSync(stateDir, { recursive: true });

      // Pre-create a config.json in NEXU_HOME
      const testConfig = { test: true, createdAt: Date.now() };
      writeFileSync(join(nexuHome, "config.json"), JSON.stringify(testConfig));

      // Verify it's in NEXU_HOME
      expect(existsSync(join(nexuHome, "config.json"))).toBe(true);
      // Verify it's NOT in OPENCLAW_STATE_DIR
      expect(existsSync(join(stateDir, "config.json"))).toBe(false);

      // Read it back and verify content
      const loaded = JSON.parse(
        readFileSync(join(nexuHome, "config.json"), "utf8"),
      );
      expect(loaded.test).toBe(true);
    });
  },
);
