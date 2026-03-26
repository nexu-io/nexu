/**
 * Data Directory Invariants — ensures data paths are correct and consistent
 * across dev mode, packaged mode, and version upgrades.
 *
 * These tests verify the directory layout documented in AGENTS.md:
 *
 * | Directory                        | Purpose                    | Survives uninstall |
 * |----------------------------------|----------------------------|--------------------|
 * | ~/.nexu (NEXU_HOME)              | User config, compiled      | Yes                |
 * | ~/Library/Application Support/   | Runtime state, OpenClaw    | No                 |
 * |   @nexu/desktop (userData)       |   conversations, skills    |                    |
 *
 * Critical invariant: NEXU_HOME and userData are SEPARATE directories.
 * Config (config.json, cloud-profiles.json) lives in NEXU_HOME.
 * Runtime state (openclaw agents, skills, extensions) lives in userData.
 * This split is intentional and must be preserved across versions.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../..");

function readFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

// =========================================================================
// 1. bootstrap.ts path configuration
// =========================================================================

describe("bootstrap.ts path configuration", () => {
  const bootstrap = readFile("apps/desktop/main/bootstrap.ts");

  it("configureLocalDevPaths is guarded by app.isPackaged", () => {
    // Must return early for packaged apps — dev path logic should never
    // affect production users
    expect(bootstrap).toContain("if (!runtimeRoot || app.isPackaged)");
  });

  it("configurePackagedPaths is guarded by !app.isPackaged", () => {
    // Must return early for dev mode
    expect(bootstrap).toContain("if (!app.isPackaged)");
  });

  it("dev mode respects externally-set NEXU_HOME", () => {
    // bootstrap.ts must NOT unconditionally overwrite NEXU_HOME.
    // It should only set it as a fallback when not already provided.
    // This prevents dev-launchd.sh's NEXU_HOME from being clobbered.
    expect(bootstrap).toContain("if (!process.env.NEXU_HOME)");
  });

  it("packaged mode does not touch NEXU_HOME env", () => {
    // configurePackagedPaths should NOT set process.env.NEXU_HOME.
    // NEXU_HOME for packaged mode is resolved by runtime-config.ts
    // from DEFAULT_NEXU_HOME (~/.nexu).
    const packagedPathsSection = bootstrap.slice(
      bootstrap.indexOf("function configurePackagedPaths"),
      bootstrap.indexOf("function configurePackagedPaths") + 800,
    );
    expect(packagedPathsSection).not.toContain("process.env.NEXU_HOME");
  });

  it("execution order: loadDevEnv → configurePackaged → configureLocalDev (call sites)", () => {
    // Look for the top-level call sites (bare function calls, not definitions)
    // They appear after all function definitions, near the end of the file
    const callSiteRegion = bootstrap.slice(
      bootstrap.lastIndexOf("loadDesktopDevEnv()"),
    );
    const loadIdx = callSiteRegion.indexOf("loadDesktopDevEnv()");
    const packagedIdx = callSiteRegion.indexOf("configurePackagedPaths()");
    const localDevIdx = callSiteRegion.indexOf("configureLocalDevPaths()");

    expect(loadIdx).toBeLessThan(packagedIdx);
    expect(packagedIdx).toBeLessThan(localDevIdx);
  });
});

// =========================================================================
// 2. runtime-config.ts NEXU_HOME resolution
// =========================================================================

describe("runtime-config.ts NEXU_HOME resolution", () => {
  const runtimeConfig = readFile("apps/desktop/shared/runtime-config.ts");

  it("NEXU_HOME defaults to ~/.nexu", () => {
    expect(runtimeConfig).toContain('DEFAULT_NEXU_HOME = "~/.nexu"');
  });

  it("env.NEXU_HOME takes priority over build config and default", () => {
    // The resolution order must be: env > buildConfig > default
    expect(runtimeConfig).toContain(
      "env.NEXU_HOME ?? buildConfig.NEXU_HOME ?? DEFAULT_NEXU_HOME",
    );
  });
});

// =========================================================================
// 3. controller env.ts NEXU_HOME dependent paths
// =========================================================================

describe("controller env.ts data paths", () => {
  const controllerEnv = readFile("apps/controller/src/app/env.ts");

  it("config.json is under NEXU_HOME", () => {
    expect(controllerEnv).toContain(
      'nexuConfigPath: path.join(nexuHomeDir, "config.json")',
    );
  });

  it("compiled-openclaw.json is under NEXU_HOME", () => {
    expect(controllerEnv).toContain(
      'path.join(\n    nexuHomeDir,\n    "compiled-openclaw.json"',
    );
  });

  it("skill-ledger.json is under NEXU_HOME", () => {
    expect(controllerEnv).toContain(
      'skillDbPath: path.join(nexuHomeDir, "skill-ledger.json")',
    );
  });

  it("skillhub-cache is under NEXU_HOME", () => {
    expect(controllerEnv).toContain(
      'skillhubCacheDir: path.join(nexuHomeDir, "skillhub-cache")',
    );
  });

  it("NEXU_HOME default is ~/.nexu", () => {
    expect(controllerEnv).toContain('NEXU_HOME: z.string().default("~/.nexu")');
  });
});

// =========================================================================
// 4. desktop-paths.ts helper functions
// =========================================================================

describe("desktop-paths.ts", () => {
  const desktopPaths = readFile("apps/desktop/shared/desktop-paths.ts");

  it("getDesktopNexuHomeDir returns userData/.nexu", () => {
    expect(desktopPaths).toContain('resolve(userDataPath, ".nexu")');
  });

  it("getOpenclawSkillsDir returns userData/runtime/openclaw/state/skills", () => {
    expect(desktopPaths).toContain(
      'resolve(userDataPath, "runtime/openclaw/state/skills")',
    );
  });
});

// =========================================================================
// 5. plist-generator.ts NEXU_HOME in launchd plists
// =========================================================================

describe("plist-generator.ts NEXU_HOME", () => {
  const plistGen = readFile("apps/desktop/main/services/plist-generator.ts");

  it("controller plist conditionally includes NEXU_HOME", () => {
    // Must be conditional (only set if nexuHome is provided)
    expect(plistGen).toContain("env.nexuHome");
    expect(plistGen).toContain("<key>NEXU_HOME</key>");
  });

  it("openclaw plist does NOT include NEXU_HOME", () => {
    // OpenClaw reads OPENCLAW_STATE_DIR and OPENCLAW_CONFIG_PATH directly,
    // it does not use NEXU_HOME. Count occurrences in the openclaw plist function.
    const openclawFn = plistGen.slice(
      plistGen.indexOf("function generateOpenclawPlist"),
    );
    expect(openclawFn).not.toContain("NEXU_HOME");
  });
});

// =========================================================================
// 6. dev-launchd.sh path consistency
// =========================================================================

describe("dev-launchd.sh data paths", () => {
  const devLaunchd = readFile("scripts/dev-launchd.sh");

  it("sets DEV_NEXU_HOME to .tmp/desktop/nexu-home", () => {
    expect(devLaunchd).toContain(
      'DEV_NEXU_HOME="$REPO_ROOT/.tmp/desktop/nexu-home"',
    );
  });

  it("passes NEXU_HOME when launching Electron", () => {
    // NEXU_HOME may be on the same line as the electron command or on
    // a preceding continuation line (bash \ line continuation).
    // Look for NEXU_HOME near the electron launch command.
    const electronIdx = devLaunchd.indexOf("pnpm exec electron apps/desktop");
    expect(electronIdx).toBeGreaterThan(-1);
    // Check within 200 chars before the electron command for NEXU_HOME
    const vicinity = devLaunchd.slice(
      Math.max(0, electronIdx - 200),
      electronIdx + 50,
    );
    expect(vicinity).toContain("NEXU_HOME");
  });

  it("OPENCLAW_STATE_DIR is derived from DEV_NEXU_HOME", () => {
    expect(devLaunchd).toContain(
      'OPENCLAW_STATE_DIR="$DEV_NEXU_HOME/runtime/openclaw/state"',
    );
  });
});

// =========================================================================
// 7. AGENTS.md directory layout contract
// =========================================================================

describe("AGENTS.md directory layout contract", () => {
  const agentsMd = readFile("AGENTS.md");

  it("documents NEXU_HOME as ~/.nexu", () => {
    expect(agentsMd).toContain("~/.nexu");
    expect(agentsMd).toContain("NEXU_HOME");
  });

  it("documents userData as ~/Library/Application Support/@nexu/desktop", () => {
    expect(agentsMd).toContain("~/Library/Application Support/@nexu/desktop");
  });

  it("documents the split: NEXU_HOME survives uninstall, userData does not", () => {
    expect(agentsMd).toContain("Survives uninstall");
  });
});

// =========================================================================
// 8. Packaged mode NEXU_HOME consistency with 0.1.7
// =========================================================================

describe("packaged mode NEXU_HOME backward compatibility", () => {
  const runtimeConfig = readFile("apps/desktop/shared/runtime-config.ts");
  const controllerEnv = readFile("apps/controller/src/app/env.ts");

  it("packaged default NEXU_HOME is ~/.nexu in both desktop and controller", () => {
    // Both must agree on the default
    expect(runtimeConfig).toContain('"~/.nexu"');
    expect(controllerEnv).toContain('"~/.nexu"');
  });

  it("no code sets NEXU_HOME unconditionally in packaged mode", () => {
    const bootstrap = readFile("apps/desktop/main/bootstrap.ts");
    // configurePackagedPaths must NOT contain NEXU_HOME assignment
    const fnStart = bootstrap.indexOf("function configurePackagedPaths");
    const fnEnd = bootstrap.indexOf("}", fnStart + 100);
    const fnBody = bootstrap.slice(fnStart, fnEnd + 200);
    expect(fnBody).not.toContain("NEXU_HOME");
  });
});

// =========================================================================
// 9. OpenClaw state directory is separate from NEXU_HOME
// =========================================================================

describe("OpenClaw state directory separation", () => {
  const indexTs = readFile("apps/desktop/main/index.ts");

  it("dev mode: openclawStateDir is under nexuHome/runtime/openclaw", () => {
    expect(indexTs).toContain('resolve(nexuHome, "runtime", "openclaw")');
  });

  it("packaged mode: openclawStateDir is under userData/runtime/openclaw", () => {
    expect(indexTs).toContain(
      'resolve(app.getPath("userData"), "runtime", "openclaw")',
    );
  });

  it("OPENCLAW_STATE_DIR is explicitly set in controller plist", () => {
    const plistGen = readFile("apps/desktop/main/services/plist-generator.ts");
    expect(plistGen).toContain("OPENCLAW_STATE_DIR");
  });
});
