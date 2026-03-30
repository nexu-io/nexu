/**
 * Plist Generator for Nexu Desktop launchd services.
 *
 * Generates launchd plist XML for Controller and OpenClaw services.
 */

import * as os from "node:os";
import * as path from "node:path";
import { SERVICE_LABELS } from "./launchd-manager";

export interface PlistEnv {
  isDev: boolean;
  logDir: string;
  controllerPort: number;
  openclawPort: number;
  /** Path to node binary */
  nodePath: string;
  /** Path to controller entry point */
  controllerEntryPath: string;
  /** Path to openclaw binary */
  openclawPath: string;
  /** OpenClaw config path */
  openclawConfigPath: string;
  /** OpenClaw state directory */
  openclawStateDir: string;
  /** Working directory for controller */
  controllerCwd: string;
  /** Working directory for openclaw */
  openclawCwd: string;
  /** NEXU_HOME override (dev: repo-local, prod: default ~/.nexu) */
  nexuHome?: string;
  /** Gateway auth token (shared between controller and openclaw) */
  gatewayToken?: string;
  /** System PATH for launchd environment */
  systemPath?: string;
  /** NODE_PATH for module resolution (TypeScript plugins need this) */
  nodeModulesPath?: string;

  // --- Controller-specific env vars (must match manifests.ts) ---
  /** Web UI URL for CORS/redirects */
  webUrl: string;
  /** OpenClaw skills directory */
  openclawSkillsDir: string;
  /** Bundled static skills directory */
  skillhubStaticSkillsDir: string;
  /** Platform templates directory */
  platformTemplatesDir: string;
  /** OpenClaw binary path */
  openclawBinPath: string;
  /** OpenClaw extensions directory */
  openclawExtensionsDir: string;
  /** Skill NODE_PATH for controller module resolution */
  skillNodePath: string;
  /** TMPDIR for openclaw temp files */
  openclawTmpDir: string;
  /** Normalized proxy env propagated to child processes */
  proxyEnv: Record<string, string>;
}

function renderProxyEnvEntries(proxyEnv: Record<string, string>): string {
  const orderedKeys = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "NODE_USE_ENV_PROXY",
  ];

  return orderedKeys
    .flatMap((key) => {
      const value = proxyEnv[key];
      if (!value) {
        return [];
      }

      return [
        `\n        <key>${key}</key>`,
        `\n        <string>${escapeXml(value)}</string>`,
      ];
    })
    .join("");
}

/**
 * Generate plist XML for a service.
 */
export function generatePlist(
  service: "controller" | "openclaw",
  env: PlistEnv,
): string {
  const label = SERVICE_LABELS[service](env.isDev);

  if (service === "controller") {
    return generateControllerPlist(label, env);
  }
  return generateOpenclawPlist(label, env);
}

function generateControllerPlist(label: string, env: PlistEnv): string {
  const logPath = path.join(env.logDir, "controller.log");
  const errorPath = path.join(env.logDir, "controller.error.log");
  const openclawLabel = SERVICE_LABELS.openclaw(env.isDev);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(env.nodePath)}</string>
        <string>${escapeXml(env.controllerEntryPath)}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${escapeXml(env.controllerCwd)}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>ELECTRON_RUN_AS_NODE</key>
        <string>1</string>
        <key>PORT</key>
        <string>${env.controllerPort}</string>
        <key>HOST</key>
        <string>127.0.0.1</string>
        <key>WEB_URL</key>
        <string>${escapeXml(env.webUrl)}</string>
        <key>OPENCLAW_GATEWAY_PORT</key>
        <string>${env.openclawPort}</string>
        <key>RUNTIME_MANAGE_OPENCLAW_PROCESS</key>
        <string>false</string>
        <key>RUNTIME_GATEWAY_PROBE_ENABLED</key>
        <string>false</string>
        <key>OPENCLAW_STATE_DIR</key>
        <string>${escapeXml(env.openclawStateDir)}</string>
        <key>OPENCLAW_CONFIG_PATH</key>
        <string>${escapeXml(env.openclawConfigPath)}</string>
        <key>OPENCLAW_SKILLS_DIR</key>
        <string>${escapeXml(env.openclawSkillsDir)}</string>
        <key>SKILLHUB_STATIC_SKILLS_DIR</key>
        <string>${escapeXml(env.skillhubStaticSkillsDir)}</string>
        <key>PLATFORM_TEMPLATES_DIR</key>
        <string>${escapeXml(env.platformTemplatesDir)}</string>
        <key>OPENCLAW_BIN</key>
        <string>${escapeXml(env.openclawBinPath)}</string>
        <key>OPENCLAW_LAUNCHD_LABEL</key>
        <string>${escapeXml(openclawLabel)}</string>
        <key>OPENCLAW_ELECTRON_EXECUTABLE</key>
        <string>${escapeXml(env.nodePath)}</string>
        <key>OPENCLAW_EXTENSIONS_DIR</key>
        <string>${escapeXml(env.openclawExtensionsDir)}</string>
        <key>NODE_PATH</key>
        <string>${escapeXml(env.skillNodePath)}</string>
        <key>OPENCLAW_DISABLE_BONJOUR</key>
        <string>1</string>
        <key>TMPDIR</key>
        <string>${escapeXml(env.openclawTmpDir)}</string>${renderProxyEnvEntries(
          env.proxyEnv,
        )}${
          env.nexuHome
            ? `
        <key>NEXU_HOME</key>
        <string>${escapeXml(env.nexuHome)}</string>`
            : ""
        }${
          env.gatewayToken
            ? `
        <key>OPENCLAW_GATEWAY_TOKEN</key>
        <string>${escapeXml(env.gatewayToken)}</string>`
            : ""
        }${
          env.systemPath
            ? `
        <key>PATH</key>
        <string>${escapeXml(env.systemPath)}</string>`
            : ""
        }
        <key>NODE_ENV</key>
        <string>${env.isDev ? "development" : "production"}</string>
        <key>HOME</key>
        <string>${escapeXml(os.homedir())}</string>
    </dict>

    <key>StandardOutPath</key>
    <string>${escapeXml(logPath)}</string>

    <key>StandardErrorPath</key>
    <string>${escapeXml(errorPath)}</string>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>ThrottleInterval</key>
    <integer>5</integer>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
`;
}

function generateOpenclawPlist(label: string, env: PlistEnv): string {
  const logPath = path.join(env.logDir, "openclaw.log");
  const errorPath = path.join(env.logDir, "openclaw.error.log");
  const controllerLabel = SERVICE_LABELS.controller(env.isDev);

  // In dev mode, use --auth none to simplify local development
  const authArgs = env.isDev
    ? `
        <string>--auth</string>
        <string>none</string>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${escapeXml(env.nodePath)}</string>
        <string>${escapeXml(env.openclawPath)}</string>
        <string>gateway</string>
        <string>run</string>${authArgs}
    </array>

    <key>WorkingDirectory</key>
    <string>${escapeXml(env.openclawCwd)}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>ELECTRON_RUN_AS_NODE</key>
        <string>1</string>
        <key>OPENCLAW_CONFIG</key>
        <string>${escapeXml(env.openclawConfigPath)}</string>
        <key>OPENCLAW_CONFIG_PATH</key>
        <string>${escapeXml(env.openclawConfigPath)}</string>
        <key>OPENCLAW_STATE_DIR</key>
        <string>${escapeXml(env.openclawStateDir)}</string>
        <key>OPENCLAW_LAUNCHD_LABEL</key>
        <string>${label}</string>
        <key>OPENCLAW_SERVICE_MARKER</key>
        <string>launchd</string>${
          env.gatewayToken
            ? `
        <key>OPENCLAW_GATEWAY_TOKEN</key>
        <string>${escapeXml(env.gatewayToken)}</string>`
            : ""
        }
        <key>HOME</key>
        <string>${escapeXml(os.homedir())}</string>${renderProxyEnvEntries(
          env.proxyEnv,
        )}${
          env.systemPath
            ? `
        <key>PATH</key>
        <string>${escapeXml(env.systemPath)}</string>`
            : ""
        }${
          env.nodeModulesPath
            ? `
        <key>NODE_PATH</key>
        <string>${escapeXml(env.nodeModulesPath)}</string>`
            : ""
        }
    </dict>

    <key>StandardOutPath</key>
    <string>${escapeXml(logPath)}</string>

    <key>StandardErrorPath</key>
    <string>${escapeXml(errorPath)}</string>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>OtherJobEnabled</key>
        <dict>
            <key>${controllerLabel}</key>
            <true/>
        </dict>
    </dict>

    <key>ThrottleInterval</key>
    <integer>5</integer>

    <key>RunAtLoad</key>
    <false/>
</dict>
</plist>
`;
}

/**
 * Escape special XML characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
