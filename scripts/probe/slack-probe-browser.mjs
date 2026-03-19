import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFilePath), "../..");
const defaultProfileDir = path.join(
  repoRoot,
  ".tmp",
  "slack-reply-probe",
  "chrome-canary-profile",
);
const defaultCanaryBinary =
  process.env.SLACK_PROBE_CANARY_BIN ??
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary";
const defaultDebugPort = Number(process.env.SLACK_PROBE_DEBUG_PORT ?? "9222");

function parseArgs(argv) {
  const options = {
    url: null,
    profileDir: defaultProfileDir,
    canaryBinary: defaultCanaryBinary,
    debugPort: defaultDebugPort,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--url") {
      options.url = argv[index + 1] ?? options.url;
      index += 1;
      continue;
    }

    if (arg === "--profile-dir") {
      options.profileDir = path.resolve(argv[index + 1] ?? options.profileDir);
      index += 1;
      continue;
    }

    if (arg === "--canary-binary") {
      options.canaryBinary = argv[index + 1] ?? options.canaryBinary;
      index += 1;
      continue;
    }

    if (arg === "--debug-port") {
      const nextValue = Number(argv[index + 1] ?? options.debugPort);
      if (!Number.isNaN(nextValue) && nextValue > 0) {
        options.debugPort = nextValue;
      }
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h" || arg === "help") {
      options.help = true;
    }
  }

  return options;
}

function printUsage() {
  console.log(
    [
      "Slack Probe Browser Launcher",
      "",
      "Usage:",
      "  pnpm probe:slack:browser --url <slack-dm-url>",
      "",
      "Options:",
      "  --url             Slack DM URL to open in Chrome Canary (required)",
      "  --profile-dir     Canary user-data dir for the Slack probe session",
      "  --canary-binary   Override the Chrome Canary executable path",
      "  --debug-port      Remote debugging port exposed for the probe",
    ].join("\n"),
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  if (!options.url) {
    throw new Error("missing required --url <slack-dm-url>");
  }

  if (!existsSync(options.canaryBinary)) {
    throw new Error(
      `chrome canary binary not found at ${options.canaryBinary}`,
    );
  }

  await mkdir(options.profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${options.debugPort}`,
    `--user-data-dir=${options.profileDir}`,
    "--new-window",
    options.url,
  ];

  const child = spawn(options.canaryBinary, args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  console.log(`[probe-browser] canaryBinary=${options.canaryBinary}`);
  console.log(`[probe-browser] profileDir=${options.profileDir}`);
  console.log(`[probe-browser] debugPort=${options.debugPort}`);
  console.log(`[probe-browser] url=${options.url}`);
  console.log(
    `[probe-browser] connect with: pnpm probe:slack --url "${options.url}" --connect-url http://127.0.0.1:${options.debugPort}`,
  );
}

main().catch((error) => {
  console.error("[probe-browser] failed to launch Chrome Canary");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }
  process.exit(1);
});
