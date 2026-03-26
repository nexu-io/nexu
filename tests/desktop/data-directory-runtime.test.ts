import { describe, expect, it } from "vitest";
import {
  getDesktopNexuHomeDir,
  getOpenclawSkillsDir,
  getSkillhubCacheDir,
} from "../../apps/desktop/shared/desktop-paths";

// =========================================================================
// Realistic inputs matching real-world configurations
// =========================================================================

const PACKAGED = {
  home: "/Users/alice",
  nexuHome: "/Users/alice/.nexu",
  userData: "/Users/alice/Library/Application Support/@nexu/desktop",
  resources: "/Applications/Nexu.app/Contents/Resources",
};

const DEV = {
  repo: "/Users/alice/code/nexu",
  nexuHome: "/Users/alice/code/nexu/.tmp/desktop/nexu-home",
  userData: "/Users/alice/code/nexu/.tmp/desktop/electron/user-data",
};

// Helper: build a full PlistEnv for generatePlist calls
function makePlistEnv(overrides?: Record<string, unknown>) {
  return {
    isDev: false,
    logDir: "/logs",
    controllerPort: 50800,
    openclawPort: 18789,
    nodePath: "/usr/bin/node",
    controllerEntryPath: "/app/controller/dist/index.js",
    openclawPath: "/app/openclaw/openclaw.mjs",
    openclawConfigPath: `${PACKAGED.userData}/runtime/openclaw/state/openclaw.json`,
    openclawStateDir: `${PACKAGED.userData}/runtime/openclaw/state`,
    controllerCwd: "/app/controller",
    openclawCwd: "/app",
    nexuHome: PACKAGED.nexuHome,
    gatewayToken: "test-token",
    systemPath: "/usr/bin:/bin",
    nodeModulesPath: "/app/node_modules",
    webUrl: "http://127.0.0.1:50810",
    openclawSkillsDir: `${PACKAGED.userData}/runtime/openclaw/state/skills`,
    skillhubStaticSkillsDir: "/app/bundled-skills",
    platformTemplatesDir: "/app/templates",
    openclawBinPath: "/app/bin/openclaw",
    openclawExtensionsDir: "/app/extensions",
    skillNodePath: "/app/skill-node-modules",
    openclawTmpDir: "/tmp/openclaw",
    ...overrides,
  };
}

// Helper: extract value of a plist <key>KEY</key>\n<string>VALUE</string> pair
function extractPlistValue(plist: string, key: string): string | null {
  const regex = new RegExp(
    `<key>${key}</key>\\s*\\n\\s*<string>([^<]*)</string>`,
  );
  const match = plist.match(regex);
  return match ? match[1] : null;
}

// =========================================================================
// 1. desktop-paths.ts — every helper function
// =========================================================================

describe("desktop-paths.ts path helpers", () => {
  it("getDesktopNexuHomeDir: packaged", () => {
    expect(getDesktopNexuHomeDir(PACKAGED.userData)).toBe(
      `${PACKAGED.userData}/.nexu`,
    );
  });

  it("getDesktopNexuHomeDir: dev", () => {
    expect(getDesktopNexuHomeDir(DEV.userData)).toBe(`${DEV.userData}/.nexu`);
  });

  it("getOpenclawSkillsDir: packaged", () => {
    expect(getOpenclawSkillsDir(PACKAGED.userData)).toBe(
      `${PACKAGED.userData}/runtime/openclaw/state/skills`,
    );
  });

  it("getOpenclawSkillsDir: dev", () => {
    expect(getOpenclawSkillsDir(DEV.userData)).toBe(
      `${DEV.userData}/runtime/openclaw/state/skills`,
    );
  });

  it("getSkillhubCacheDir: packaged", () => {
    expect(getSkillhubCacheDir(PACKAGED.userData)).toBe(
      `${PACKAGED.userData}/runtime/skillhub-cache`,
    );
  });

  it("getSkillhubCacheDir: dev", () => {
    expect(getSkillhubCacheDir(DEV.userData)).toBe(
      `${DEV.userData}/runtime/skillhub-cache`,
    );
  });
});

// =========================================================================
// 2. runtime-config.ts — NEXU_HOME resolution priority chain
// =========================================================================

describe("runtime-config.ts NEXU_HOME resolution", () => {
  it("defaults to ~/.nexu when nothing is set", async () => {
    const { getDesktopRuntimeConfig } = await import(
      "../../apps/desktop/shared/runtime-config"
    );
    const config = getDesktopRuntimeConfig({}, { appVersion: "0.2.0" });
    expect(config.paths.nexuHome).toBe("~/.nexu");
  });

  it("env NEXU_HOME overrides default", async () => {
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
// 3. Controller plist — verify EVERY env var that points to a data path
// =========================================================================

describe("controller plist: every data path env var", () => {
  let plist: string;

  it("generates valid plist", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    plist = generatePlist("controller", makePlistEnv() as never);
    expect(plist).toContain("<?xml");
  });

  // --- NEXU_HOME ---
  it("NEXU_HOME points to ~/.nexu", () => {
    expect(extractPlistValue(plist, "NEXU_HOME")).toBe(PACKAGED.nexuHome);
  });

  // --- OPENCLAW_STATE_DIR ---
  it("OPENCLAW_STATE_DIR points to userData/runtime/openclaw/state", () => {
    expect(extractPlistValue(plist, "OPENCLAW_STATE_DIR")).toBe(
      `${PACKAGED.userData}/runtime/openclaw/state`,
    );
  });

  // --- OPENCLAW_CONFIG_PATH ---
  it("OPENCLAW_CONFIG_PATH points to stateDir/openclaw.json", () => {
    expect(extractPlistValue(plist, "OPENCLAW_CONFIG_PATH")).toBe(
      `${PACKAGED.userData}/runtime/openclaw/state/openclaw.json`,
    );
  });

  // --- OPENCLAW_SKILLS_DIR ---
  it("OPENCLAW_SKILLS_DIR points to stateDir/skills", () => {
    expect(extractPlistValue(plist, "OPENCLAW_SKILLS_DIR")).toBe(
      `${PACKAGED.userData}/runtime/openclaw/state/skills`,
    );
  });

  // --- OPENCLAW_EXTENSIONS_DIR ---
  it("OPENCLAW_EXTENSIONS_DIR points to openclaw package extensions/", () => {
    expect(extractPlistValue(plist, "OPENCLAW_EXTENSIONS_DIR")).toBe(
      "/app/extensions",
    );
  });

  // --- SKILLHUB_STATIC_SKILLS_DIR ---
  it("SKILLHUB_STATIC_SKILLS_DIR points to bundled skills", () => {
    expect(extractPlistValue(plist, "SKILLHUB_STATIC_SKILLS_DIR")).toBe(
      "/app/bundled-skills",
    );
  });

  // --- PLATFORM_TEMPLATES_DIR ---
  it("PLATFORM_TEMPLATES_DIR points to templates dir", () => {
    expect(extractPlistValue(plist, "PLATFORM_TEMPLATES_DIR")).toBe(
      "/app/templates",
    );
  });

  // --- OPENCLAW_BIN ---
  it("OPENCLAW_BIN points to openclaw binary", () => {
    expect(extractPlistValue(plist, "OPENCLAW_BIN")).toBe("/app/bin/openclaw");
  });

  // --- OPENCLAW_ELECTRON_EXECUTABLE ---
  it("OPENCLAW_ELECTRON_EXECUTABLE points to Electron binary", () => {
    // process.execPath at test time is node, but in prod it's the Electron binary
    expect(extractPlistValue(plist, "OPENCLAW_ELECTRON_EXECUTABLE")).toBe(
      process.execPath,
    );
  });

  // --- NODE_PATH (skill module resolution) ---
  it("NODE_PATH set for skill module resolution", () => {
    expect(extractPlistValue(plist, "NODE_PATH")).toBe(
      "/app/skill-node-modules",
    );
  });

  // --- TMPDIR ---
  it("TMPDIR points to openclaw temp dir", () => {
    expect(extractPlistValue(plist, "TMPDIR")).toBe("/tmp/openclaw");
  });

  // --- PORT ---
  it("PORT is controller port", () => {
    expect(extractPlistValue(plist, "PORT")).toBe("50800");
  });

  // --- HOST ---
  it("HOST is 127.0.0.1", () => {
    expect(extractPlistValue(plist, "HOST")).toBe("127.0.0.1");
  });

  // --- WEB_URL ---
  it("WEB_URL points to web UI", () => {
    expect(extractPlistValue(plist, "WEB_URL")).toBe("http://127.0.0.1:50810");
  });

  // --- OPENCLAW_GATEWAY_PORT ---
  it("OPENCLAW_GATEWAY_PORT is openclaw port", () => {
    expect(extractPlistValue(plist, "OPENCLAW_GATEWAY_PORT")).toBe("18789");
  });

  // --- OPENCLAW_GATEWAY_TOKEN ---
  it("OPENCLAW_GATEWAY_TOKEN is set", () => {
    expect(extractPlistValue(plist, "OPENCLAW_GATEWAY_TOKEN")).toBe(
      "test-token",
    );
  });

  // --- ELECTRON_RUN_AS_NODE ---
  it("ELECTRON_RUN_AS_NODE is 1", () => {
    expect(extractPlistValue(plist, "ELECTRON_RUN_AS_NODE")).toBe("1");
  });

  // --- RUNTIME_MANAGE_OPENCLAW_PROCESS ---
  it("RUNTIME_MANAGE_OPENCLAW_PROCESS is false (launchd manages it)", () => {
    expect(extractPlistValue(plist, "RUNTIME_MANAGE_OPENCLAW_PROCESS")).toBe(
      "false",
    );
  });

  // --- RUNTIME_GATEWAY_PROBE_ENABLED ---
  it("RUNTIME_GATEWAY_PROBE_ENABLED is false", () => {
    expect(extractPlistValue(plist, "RUNTIME_GATEWAY_PROBE_ENABLED")).toBe(
      "false",
    );
  });

  // --- OPENCLAW_DISABLE_BONJOUR ---
  it("OPENCLAW_DISABLE_BONJOUR is 1", () => {
    expect(extractPlistValue(plist, "OPENCLAW_DISABLE_BONJOUR")).toBe("1");
  });

  // --- NODE_ENV ---
  it("NODE_ENV is production when isDev=false", () => {
    expect(extractPlistValue(plist, "NODE_ENV")).toBe("production");
  });

  // --- HOME ---
  it("HOME is set to os.homedir()", () => {
    const home = extractPlistValue(plist, "HOME");
    expect(home).toBeTruthy();
    expect(home).not.toBe("");
  });

  // --- PATH ---
  it("PATH includes system paths", () => {
    expect(extractPlistValue(plist, "PATH")).toBe("/usr/bin:/bin");
  });

  // --- NEXU_HOME omitted when not provided ---
  it("NEXU_HOME omitted from plist when nexuHome is undefined", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const noHomePlist = generatePlist(
      "controller",
      makePlistEnv({ nexuHome: undefined }) as never,
    );
    expect(extractPlistValue(noHomePlist, "NEXU_HOME")).toBeNull();
  });

  // --- NODE_ENV dev ---
  it("NODE_ENV is development when isDev=true", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const devPlist = generatePlist(
      "controller",
      makePlistEnv({ isDev: true }) as never,
    );
    expect(extractPlistValue(devPlist, "NODE_ENV")).toBe("development");
  });
});

// =========================================================================
// 4. OpenClaw plist — verify every env var
// =========================================================================

describe("openclaw plist: every data path env var", () => {
  let plist: string;

  it("generates valid plist", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    plist = generatePlist("openclaw", makePlistEnv() as never);
    expect(plist).toContain("<?xml");
  });

  it("ELECTRON_RUN_AS_NODE is 1", () => {
    expect(extractPlistValue(plist, "ELECTRON_RUN_AS_NODE")).toBe("1");
  });

  it("OPENCLAW_CONFIG points to config path", () => {
    expect(extractPlistValue(plist, "OPENCLAW_CONFIG")).toBe(
      `${PACKAGED.userData}/runtime/openclaw/state/openclaw.json`,
    );
  });

  it("OPENCLAW_CONFIG_PATH points to config path", () => {
    expect(extractPlistValue(plist, "OPENCLAW_CONFIG_PATH")).toBe(
      `${PACKAGED.userData}/runtime/openclaw/state/openclaw.json`,
    );
  });

  it("OPENCLAW_STATE_DIR points to state dir", () => {
    expect(extractPlistValue(plist, "OPENCLAW_STATE_DIR")).toBe(
      `${PACKAGED.userData}/runtime/openclaw/state`,
    );
  });

  it("OPENCLAW_LAUNCHD_LABEL is set to prod label", () => {
    expect(extractPlistValue(plist, "OPENCLAW_LAUNCHD_LABEL")).toBe(
      "io.nexu.openclaw",
    );
  });

  it("OPENCLAW_SERVICE_MARKER is launchd", () => {
    expect(extractPlistValue(plist, "OPENCLAW_SERVICE_MARKER")).toBe("launchd");
  });

  it("HOME is set", () => {
    expect(extractPlistValue(plist, "HOME")).toBeTruthy();
  });

  it("PATH is set when systemPath provided", () => {
    expect(extractPlistValue(plist, "PATH")).toBe("/usr/bin:/bin");
  });

  it("NODE_PATH is set when nodeModulesPath provided", () => {
    expect(extractPlistValue(plist, "NODE_PATH")).toBe("/app/node_modules");
  });

  it("does NOT contain NEXU_HOME (openclaw does not use it)", () => {
    expect(extractPlistValue(plist, "NEXU_HOME")).toBeNull();
  });

  it("does NOT contain PORT (openclaw uses gateway port from config)", () => {
    expect(extractPlistValue(plist, "PORT")).toBeNull();
  });

  it("dev label uses .dev suffix", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const devPlist = generatePlist(
      "openclaw",
      makePlistEnv({ isDev: true }) as never,
    );
    expect(extractPlistValue(devPlist, "OPENCLAW_LAUNCHD_LABEL")).toBe(
      "io.nexu.openclaw.dev",
    );
  });
});

// =========================================================================
// 5. Controller plist structural checks
// =========================================================================

describe("controller plist structural checks", () => {
  it("ProgramArguments uses nodePath + controllerEntryPath", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("controller", makePlistEnv() as never);

    expect(plist).toContain("<string>/usr/bin/node</string>");
    expect(plist).toContain("<string>/app/controller/dist/index.js</string>");
  });

  it("WorkingDirectory is controllerCwd", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("controller", makePlistEnv() as never);

    // WorkingDirectory appears outside EnvironmentVariables
    const wdMatch = plist.match(
      /<key>WorkingDirectory<\/key>\s*\n\s*<string>([^<]*)<\/string>/,
    );
    expect(wdMatch?.[1]).toBe("/app/controller");
  });

  it("StandardOutPath and StandardErrorPath under logDir", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("controller", makePlistEnv() as never);

    const outMatch = plist.match(
      /<key>StandardOutPath<\/key>\s*\n\s*<string>([^<]*)<\/string>/,
    );
    const errMatch = plist.match(
      /<key>StandardErrorPath<\/key>\s*\n\s*<string>([^<]*)<\/string>/,
    );
    expect(outMatch?.[1]).toBe("/logs/controller.log");
    expect(errMatch?.[1]).toBe("/logs/controller.error.log");
  });

  it("KeepAlive.SuccessfulExit is false", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("controller", makePlistEnv() as never);

    expect(plist).toContain("<key>SuccessfulExit</key>");
    expect(plist).toContain("<false/>");
  });

  it("RunAtLoad is false", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("controller", makePlistEnv() as never);

    const runAtLoadMatch = plist.match(
      /<key>RunAtLoad<\/key>\s*\n\s*<(true|false)\/>/,
    );
    expect(runAtLoadMatch?.[1]).toBe("false");
  });

  it("Label uses prod label for isDev=false", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("controller", makePlistEnv() as never);

    const labelMatch = plist.match(
      /<key>Label<\/key>\s*\n\s*<string>([^<]*)<\/string>/,
    );
    expect(labelMatch?.[1]).toBe("io.nexu.controller");
  });

  it("Label uses dev label for isDev=true", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist(
      "controller",
      makePlistEnv({ isDev: true }) as never,
    );

    const labelMatch = plist.match(
      /<key>Label<\/key>\s*\n\s*<string>([^<]*)<\/string>/,
    );
    expect(labelMatch?.[1]).toBe("io.nexu.controller.dev");
  });
});

// =========================================================================
// 6. OpenClaw plist structural checks
// =========================================================================

describe("openclaw plist structural checks", () => {
  it("ProgramArguments includes gateway run command", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("openclaw", makePlistEnv() as never);

    expect(plist).toContain("<string>gateway</string>");
    expect(plist).toContain("<string>run</string>");
  });

  it("dev mode adds --auth none arguments", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist(
      "openclaw",
      makePlistEnv({ isDev: true }) as never,
    );

    expect(plist).toContain("<string>--auth</string>");
    expect(plist).toContain("<string>none</string>");
  });

  it("prod mode does NOT add --auth none", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist(
      "openclaw",
      makePlistEnv({ isDev: false }) as never,
    );

    expect(plist).not.toContain("<string>--auth</string>");
  });

  it("OtherJobEnabled references controller label", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("openclaw", makePlistEnv() as never);

    expect(plist).toContain("<key>OtherJobEnabled</key>");
    expect(plist).toContain("<key>io.nexu.controller</key>");
  });

  it("StandardOutPath and StandardErrorPath under logDir", async () => {
    const { generatePlist } = await import(
      "../../apps/desktop/main/services/plist-generator"
    );
    const plist = generatePlist("openclaw", makePlistEnv() as never);

    const outMatch = plist.match(
      /<key>StandardOutPath<\/key>\s*\n\s*<string>([^<]*)<\/string>/,
    );
    const errMatch = plist.match(
      /<key>StandardErrorPath<\/key>\s*\n\s*<string>([^<]*)<\/string>/,
    );
    expect(outMatch?.[1]).toBe("/logs/openclaw.log");
    expect(errMatch?.[1]).toBe("/logs/openclaw.error.log");
  });
});

// =========================================================================
// 7. resolveLaunchdPaths — real output verification
// =========================================================================

describe("resolveLaunchdPaths real output", () => {
  it("dev mode: all paths are absolute and under repo", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const paths = resolveLaunchdPaths(false, "/ignored");

    expect(paths.nodePath).toBe(process.execPath);
    expect(paths.controllerEntryPath).toMatch(
      /\/apps\/controller\/dist\/index\.js$/,
    );
    expect(paths.openclawPath).toMatch(
      /\/openclaw-runtime\/node_modules\/openclaw\/openclaw\.mjs$/,
    );
    expect(paths.controllerCwd).toMatch(/\/apps\/controller$/);
    // All paths should be absolute
    for (const p of Object.values(paths)) {
      expect(p).toMatch(/^\//);
    }
  });

  it("packaged mode: all paths relative to resources", async () => {
    const { resolveLaunchdPaths } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const paths = resolveLaunchdPaths(true, "/App/Resources");

    expect(paths.controllerEntryPath).toBe(
      "/App/Resources/runtime/controller/dist/index.js",
    );
    expect(paths.controllerCwd).toBe("/App/Resources/runtime/controller");
    expect(paths.nodePath).toBe(process.execPath);
    expect(paths.openclawPath).toMatch(/openclaw\.mjs$/);
  });
});

// =========================================================================
// 8. getDefaultPlistDir + getLogDir — real output
// =========================================================================

describe("plist and log directory resolution", () => {
  it("dev plist dir is repo/.tmp/launchd", async () => {
    const { getDefaultPlistDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const dir = getDefaultPlistDir(true);
    expect(dir).toMatch(/\.tmp\/launchd$/);
    expect(dir).toMatch(/^\//); // absolute
  });

  it("prod plist dir is ~/Library/LaunchAgents", async () => {
    const { getDefaultPlistDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const dir = getDefaultPlistDir(false);
    expect(dir).toMatch(/Library\/LaunchAgents$/);
  });

  it("dev log dir is nexuHome/logs", async () => {
    const { getLogDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    expect(getLogDir("/custom/nexu-home")).toBe("/custom/nexu-home/logs");
  });

  it("prod log dir is ~/.nexu/logs", async () => {
    const { getLogDir } = await import(
      "../../apps/desktop/main/services/launchd-bootstrap"
    );
    const dir = getLogDir();
    expect(dir).toMatch(/\.nexu\/logs$/);
  });
});

// =========================================================================
// 9. Directory tree separation invariants
// =========================================================================

describe("directory tree separation", () => {
  it("packaged: NEXU_HOME and userData never overlap", () => {
    expect(PACKAGED.nexuHome.startsWith(PACKAGED.userData)).toBe(false);
    expect(PACKAGED.userData.startsWith(PACKAGED.nexuHome)).toBe(false);
  });

  it("dev: NEXU_HOME and userData never overlap", () => {
    expect(DEV.nexuHome.startsWith(DEV.userData)).toBe(false);
    expect(DEV.userData.startsWith(DEV.nexuHome)).toBe(false);
  });

  it("packaged: NEXU_HOME is under home (survives uninstall)", () => {
    expect(PACKAGED.nexuHome).toBe(`${PACKAGED.home}/.nexu`);
  });

  it("packaged: userData is under Application Support (removed on uninstall)", () => {
    expect(PACKAGED.userData).toContain("Application Support");
  });

  it("dev: all state is repo-scoped under .tmp/", () => {
    expect(DEV.nexuHome).toContain(".tmp/");
    expect(DEV.userData).toContain(".tmp/");
    expect(DEV.nexuHome.startsWith(DEV.repo)).toBe(true);
    expect(DEV.userData.startsWith(DEV.repo)).toBe(true);
  });
});
