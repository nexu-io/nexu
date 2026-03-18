import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const maxHealthAttempts = 60;

function parseArgs(argv) {
  const [mode, ...rest] = argv;

  if (!mode || (mode !== "dev" && mode !== "dist")) {
    throw new Error(
      "Usage: node scripts/desktop-ci-check.mjs <dev|dist> [--capture-dir <path>]",
    );
  }

  let captureDir = null;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--capture-dir") {
      captureDir = rest[index + 1] ? resolve(repoRoot, rest[index + 1]) : null;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { mode, captureDir };
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function compactPaths(paths) {
  return [...new Set(paths.filter(Boolean))];
}

function createCheckContext(mode) {
  if (mode === "dev") {
    const desktopLogsDir = resolve(repoRoot, ".tmp/desktop/electron/logs");
    const runtimeUnitLogsDir = resolve(desktopLogsDir, "runtime-units");

    return {
      mode,
      statusCommand: ["pnpm", ["desktop:status"]],
      ports: [
        { unit: "pglite", port: 50832 },
        { unit: "api", port: 50800 },
        { unit: "web", port: 50810 },
      ],
      readinessUrls: {
        api: "http://127.0.0.1:50800/api/internal/desktop/ready",
        web: "http://127.0.0.1:50810/api/internal/desktop/ready",
        webSurface: "http://127.0.0.1:50810/",
        openclawHealth: "http://127.0.0.1:18789/health",
      },
      diagnosticsFiles: [resolve(desktopLogsDir, "desktop-diagnostics.json")],
      logs: {
        coldStart: [resolve(desktopLogsDir, "cold-start.log")],
        desktopMain: [resolve(desktopLogsDir, "desktop-main.log")],
        pglite: [resolve(runtimeUnitLogsDir, "pglite.log")],
        api: [resolve(runtimeUnitLogsDir, "api.log")],
        web: [resolve(runtimeUnitLogsDir, "web.log")],
        gateway: [resolve(runtimeUnitLogsDir, "gateway.log")],
        openclaw: [resolve(runtimeUnitLogsDir, "openclaw.log")],
      },
      capturePaths: [
        { source: resolve(repoRoot, ".tmp/logs"), target: "repo-logs" },
        { source: desktopLogsDir, target: "electron-logs" },
      ],
    };
  }

  const packagedLogsDir = process.env.PACKAGED_LOGS_DIR;
  const packagedRuntimeLogsDir = process.env.PACKAGED_RUNTIME_LOGS_DIR;

  if (!packagedLogsDir || !packagedRuntimeLogsDir) {
    throw new Error(
      "Dist mode requires PACKAGED_LOGS_DIR and PACKAGED_RUNTIME_LOGS_DIR environment variables.",
    );
  }

  return {
    mode,
    statusCommand: null,
    ports: [
      { unit: "pglite", port: 50832 },
      { unit: "api", port: 50800 },
      { unit: "web", port: 50810 },
    ],
    readinessUrls: {
      api: "http://127.0.0.1:50800/api/internal/desktop/ready",
      web: "http://127.0.0.1:50810/api/internal/desktop/ready",
      webSurface: "http://127.0.0.1:50810/",
      openclawHealth: "http://127.0.0.1:18789/health",
    },
    diagnosticsFiles: compactPaths([
      resolve(packagedLogsDir, "desktop-diagnostics.json"),
      process.env.DEFAULT_LOGS_DIR
        ? resolve(process.env.DEFAULT_LOGS_DIR, "desktop-diagnostics.json")
        : null,
    ]),
    logs: {
      coldStart: compactPaths([
        resolve(packagedLogsDir, "cold-start.log"),
        process.env.DEFAULT_LOGS_DIR
          ? resolve(process.env.DEFAULT_LOGS_DIR, "cold-start.log")
          : null,
      ]),
      desktopMain: compactPaths([
        resolve(packagedLogsDir, "desktop-main.log"),
        process.env.DEFAULT_LOGS_DIR
          ? resolve(process.env.DEFAULT_LOGS_DIR, "desktop-main.log")
          : null,
      ]),
      pglite: compactPaths([
        resolve(packagedRuntimeLogsDir, "pglite.log"),
        process.env.DEFAULT_RUNTIME_LOGS_DIR
          ? resolve(process.env.DEFAULT_RUNTIME_LOGS_DIR, "pglite.log")
          : null,
      ]),
      api: compactPaths([
        resolve(packagedRuntimeLogsDir, "api.log"),
        process.env.DEFAULT_RUNTIME_LOGS_DIR
          ? resolve(process.env.DEFAULT_RUNTIME_LOGS_DIR, "api.log")
          : null,
      ]),
      web: compactPaths([
        resolve(packagedRuntimeLogsDir, "web.log"),
        process.env.DEFAULT_RUNTIME_LOGS_DIR
          ? resolve(process.env.DEFAULT_RUNTIME_LOGS_DIR, "web.log")
          : null,
      ]),
      gateway: compactPaths([
        resolve(packagedRuntimeLogsDir, "gateway.log"),
        process.env.DEFAULT_RUNTIME_LOGS_DIR
          ? resolve(process.env.DEFAULT_RUNTIME_LOGS_DIR, "gateway.log")
          : null,
      ]),
      openclaw: compactPaths([
        resolve(packagedRuntimeLogsDir, "openclaw.log"),
        process.env.DEFAULT_RUNTIME_LOGS_DIR
          ? resolve(process.env.DEFAULT_RUNTIME_LOGS_DIR, "openclaw.log")
          : null,
      ]),
    },
    capturePaths: [
      { source: packagedLogsDir, target: "packaged-logs" },
      { source: packagedRuntimeLogsDir, target: "runtime-unit-logs" },
      ...(process.env.DEFAULT_LOGS_DIR
        ? [
            {
              source: resolve(process.env.DEFAULT_LOGS_DIR),
              target: "default-logs",
            },
          ]
        : []),
      ...(process.env.DEFAULT_RUNTIME_LOGS_DIR
        ? [
            {
              source: resolve(process.env.DEFAULT_RUNTIME_LOGS_DIR),
              target: "default-runtime-unit-logs",
            },
          ]
        : []),
    ],
  };
}

async function runCommand(command, args) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          `Command failed: ${command} ${args.join(" ")} (exit ${code ?? "null"})`,
        ),
      );
    });
  });
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readLogIfExists(filePath) {
  if (!filePath) {
    return null;
  }

  if (!(await fileExists(filePath))) {
    return null;
  }

  return readFile(filePath, "utf8");
}

async function readJsonIfExists(filePath) {
  if (!filePath) {
    return null;
  }

  if (!(await fileExists(filePath))) {
    return null;
  }

  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function firstExistingPath(paths) {
  for (const filePath of paths) {
    if (await fileExists(filePath)) {
      return filePath;
    }
  }

  return paths[0] ?? null;
}

async function resolveLogTargets(context) {
  const logs = Object.fromEntries(
    await Promise.all(
      Object.entries(context.logs).map(async ([unit, paths]) => [
        unit,
        await firstExistingPath(paths),
      ]),
    ),
  );

  return {
    diagnosticsFile: await firstExistingPath(context.diagnosticsFiles),
    logs,
  };
}

async function isPortListening(port) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("lsof", [`-iTCP:${String(port)}`, "-sTCP:LISTEN"], {
      cwd: repoRoot,
      env: process.env,
      stdio: "ignore",
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => resolvePromise(code === 0));
  });
}

async function fetchText(url) {
  try {
    const response = await fetch(url);
    const body = await response.text();
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildMissingCheckSummary(missingChecks) {
  return missingChecks
    .map((entry) => ` - ${entry.unit} :: ${entry.detail}`)
    .join("\n");
}

async function collectProbeResults(context) {
  const portResults = await Promise.all(
    context.ports.map(async ({ unit, port }) => ({
      unit,
      port,
      listening: await isPortListening(port),
    })),
  );

  const [apiReady, webReady, webSurface, openclawHealth] = await Promise.all([
    fetchText(context.readinessUrls.api),
    fetchText(context.readinessUrls.web),
    fetchText(context.readinessUrls.webSurface),
    fetchText(context.readinessUrls.openclawHealth),
  ]);

  const browserControlListening = await isPortListening(18791);

  return {
    portResults,
    apiReady,
    webReady,
    webSurface,
    openclawHealth,
    browserControlListening,
  };
}

function probesPassed(results) {
  return (
    results.portResults.every((entry) => entry.listening) &&
    results.apiReady.body.includes('"ready":true') &&
    results.webReady.body.includes('"ready":true') &&
    results.webSurface.body.includes('<div id="root"></div>') &&
    results.openclawHealth.ok &&
    results.browserControlListening
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeUnitState(value) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.phase === "string" &&
    (typeof value.lastError === "string" || value.lastError === null) &&
    (typeof value.port === "number" || value.port === null)
  );
}

function collectDiagnosticsIssues(diagnostics, count) {
  const entries = diagnostics?.runtime?.recentEvents;
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter(
      (entry) =>
        isRecord(entry) &&
        typeof entry.ts === "string" &&
        typeof entry.unitId === "string" &&
        typeof entry.reasonCode === "string" &&
        typeof entry.message === "string",
    )
    .map((entry) => {
      const actionLabel =
        typeof entry.actionId === "string" && entry.actionId.length > 0
          ? ` [action=${entry.actionId}]`
          : "";
      return `${entry.ts} ${entry.unitId} [reason=${entry.reasonCode}]${actionLabel} ${entry.message}`;
    })
    .slice(-count);
}

function formatDiagnosticsSnapshot(diagnostics) {
  if (!diagnostics || !isRecord(diagnostics)) {
    return ["diagnostics: unavailable"];
  }

  const lines = [];
  const coldStart = diagnostics.coldStart;
  const renderer = diagnostics.renderer;
  const units = diagnostics?.runtime?.state?.units;

  lines.push(
    `updatedAt: ${typeof diagnostics.updatedAt === "string" ? diagnostics.updatedAt : "unknown"}`,
  );

  if (isRecord(coldStart)) {
    const coldStartParts = [
      `status=${typeof coldStart.status === "string" ? coldStart.status : "unknown"}`,
      typeof coldStart.step === "string" && coldStart.step.length > 0
        ? `step=${coldStart.step}`
        : null,
      typeof coldStart.error === "string" && coldStart.error.length > 0
        ? `error=${coldStart.error}`
        : null,
    ].filter(Boolean);
    lines.push(`coldStart: ${coldStartParts.join(", ")}`);
  }

  if (isRecord(renderer)) {
    const rendererParts = [
      `didFinishLoad=${String(renderer.didFinishLoad === true)}`,
      typeof renderer.lastUrl === "string" && renderer.lastUrl.length > 0
        ? `lastUrl=${renderer.lastUrl}`
        : null,
      typeof renderer.lastError === "string" && renderer.lastError.length > 0
        ? `lastError=${renderer.lastError}`
        : null,
    ].filter(Boolean);

    if (isRecord(renderer.processGone) && renderer.processGone.seen === true) {
      rendererParts.push(
        `processGone=${renderer.processGone.reason ?? "unknown"}/${String(renderer.processGone.exitCode ?? "null")}`,
      );
    }

    lines.push(`renderer: ${rendererParts.join(", ")}`);
  }

  if (Array.isArray(units)) {
    const unitSummary = units
      .filter(isRuntimeUnitState)
      .map((unit) => {
        const parts = [unit.phase];
        if (unit.lastError) {
          parts.push(`error=${unit.lastError}`);
        }
        if (typeof unit.port === "number") {
          parts.push(`port=${String(unit.port)}`);
        }
        return `${unit.id}:${parts.join(",")}`;
      })
      .join(" | ");

    lines.push(`units: ${unitSummary || "none"}`);
  }

  return lines;
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeLogEntry(parsed) {
  if (!isRecord(parsed)) {
    return null;
  }

  const runtimeAppLog = isRecord(parsed.runtime_app_log)
    ? parsed.runtime_app_log
    : null;
  const topLevelMessage =
    typeof parsed.msg === "string"
      ? parsed.msg
      : typeof parsed.message === "string"
        ? parsed.message
        : null;
  const nestedMessage = runtimeAppLog
    ? typeof runtimeAppLog.msg === "string"
      ? runtimeAppLog.msg
      : typeof runtimeAppLog.message === "string"
        ? runtimeAppLog.message
        : null
    : null;
  const level =
    typeof parsed.level === "number"
      ? parsed.level
      : runtimeAppLog && typeof runtimeAppLog.level === "number"
        ? runtimeAppLog.level
        : null;

  return {
    level,
    time:
      typeof parsed.time === "string"
        ? parsed.time
        : runtimeAppLog && typeof runtimeAppLog.time === "string"
          ? runtimeAppLog.time
          : null,
    unit:
      typeof parsed.runtime_unit_id === "string"
        ? parsed.runtime_unit_id
        : typeof parsed.desktop_log_source === "string"
          ? parsed.desktop_log_source
          : null,
    stream:
      typeof parsed.runtime_log_stream === "string"
        ? parsed.runtime_log_stream
        : typeof parsed.desktop_log_stream === "string"
          ? parsed.desktop_log_stream
          : null,
    reason:
      typeof parsed.runtime_reason_code === "string"
        ? parsed.runtime_reason_code
        : typeof parsed.desktop_log_kind === "string"
          ? parsed.desktop_log_kind
          : null,
    message: nestedMessage ?? topLevelMessage,
    payload: runtimeAppLog ?? parsed,
  };
}

function formatLevel(level) {
  if (typeof level !== "number") {
    return "LOG";
  }
  if (level >= 50) {
    return "ERROR";
  }
  if (level >= 40) {
    return "WARN";
  }
  return "INFO";
}

function summarizePayload(payload) {
  if (!isRecord(payload)) {
    return "";
  }

  const summaryEntries = [];
  for (const [key, value] of Object.entries(payload)) {
    if (
      key === "level" ||
      key === "time" ||
      key === "msg" ||
      key === "message" ||
      key === "service" ||
      key === "env" ||
      key === "version"
    ) {
      continue;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      summaryEntries.push(`${key}=${String(value)}`);
      continue;
    }

    if (isRecord(value) && typeof value.message === "string") {
      summaryEntries.push(`${key}.message=${value.message}`);
    }
  }

  return summaryEntries.join(", ");
}

function collectReadableIssues(content, count) {
  const issues = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const parsed = parseJsonLine(line);
    const entry = normalizeLogEntry(parsed);

    if (!entry || typeof entry.level !== "number" || entry.level < 40) {
      continue;
    }

    const summary = summarizePayload(entry.payload);
    issues.push(
      [
        `[${formatLevel(entry.level)}]`,
        entry.time ?? "unknown-time",
        entry.unit ? `${entry.unit}` : null,
        entry.reason ? `(${entry.reason})` : null,
        entry.message ?? "<no message>",
        summary ? `-- ${summary}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  return issues.slice(-count);
}

async function captureLogs(context, captureDir) {
  if (!captureDir) {
    return;
  }

  await mkdir(captureDir, { recursive: true });

  for (const entry of context.capturePaths) {
    if (!(await fileExists(entry.source))) {
      continue;
    }

    await cp(entry.source, join(captureDir, entry.target), {
      recursive: true,
      force: true,
    });
  }

  if (context.mode === "dev") {
    const tmuxCapturePath = join(captureDir, "tmux.log");

    await new Promise((resolvePromise) => {
      const child = spawn(
        "tmux",
        ["capture-pane", "-pt", "nexu-desktop", "-S", "-400"],
        {
          cwd: repoRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );

      const chunks = [];
      child.stdout.on("data", (chunk) => chunks.push(chunk));
      child.on("exit", async (code) => {
        if (code === 0) {
          await writeFile(tmuxCapturePath, Buffer.concat(chunks));
        }
        resolvePromise();
      });
      child.on("error", () => resolvePromise());
    });
  }
}

async function verifyRuntime(context) {
  const resolvedTargets = await resolveLogTargets(context);
  const { logs, diagnosticsFile } = resolvedTargets;

  if (context.statusCommand) {
    await runCommand(context.statusCommand[0], context.statusCommand[1]);
  }

  for (let attempt = 1; attempt <= maxHealthAttempts; attempt += 1) {
    console.log(`Runtime health attempt ${attempt}/${maxHealthAttempts}`);

    const probeResults = await collectProbeResults(context);

    if (probesPassed(probeResults)) {
      break;
    }

    await sleep(2000);
  }

  const contents = {
    coldStart: await readLogIfExists(logs.coldStart),
    desktopMain: await readLogIfExists(logs.desktopMain),
    pglite: await readLogIfExists(logs.pglite),
    api: await readLogIfExists(logs.api),
    web: await readLogIfExists(logs.web),
    gateway: await readLogIfExists(logs.gateway),
    openclaw: await readLogIfExists(logs.openclaw),
  };
  const diagnostics = diagnosticsFile
    ? await readJsonIfExists(diagnosticsFile)
    : null;
  const probeResults = await collectProbeResults(context);

  const missingChecks = [];
  const addMissing = (unit, detail) => missingChecks.push({ unit, detail });

  for (const { unit, port, listening } of probeResults.portResults) {
    if (!listening) {
      addMissing(unit, `port ${port} is not listening`);
    }
  }

  if (!probeResults.apiReady.body.includes('"ready":true')) {
    addMissing(
      "api",
      `readiness endpoint body: ${probeResults.apiReady.body || "<no response>"}`,
    );
  }

  if (!probeResults.webReady.body.includes('"ready":true')) {
    addMissing(
      "web",
      `readiness endpoint body: ${probeResults.webReady.body || "<no response>"}`,
    );
  }

  if (!probeResults.webSurface.body.includes('<div id="root"></div>')) {
    addMissing("web", "root document did not contain app mount node");
  }

  if (!probeResults.browserControlListening) {
    addMissing("openclaw", "browser control port 18791 is not listening");
  }

  if (!probeResults.openclawHealth.ok) {
    addMissing(
      "openclaw",
      `health endpoint response: ${probeResults.openclawHealth.body || "<no response>"}`,
    );
  }

  if (missingChecks.length === 0) {
    console.log(
      `${context.mode === "dev" ? "Desktop" : "Packaged"} runtime health verification passed.`,
    );
    return;
  }

  console.error(
    `${context.mode === "dev" ? "Desktop" : "Packaged"} runtime health verification failed. Missing checks:\n${buildMissingCheckSummary(missingChecks)}`,
  );
  console.error("\nPersistent log files checked:");
  for (const filePath of Object.values(logs)) {
    if (filePath) {
      console.error(` - ${filePath}`);
    }
  }
  if (diagnosticsFile) {
    console.error(` - ${diagnosticsFile}`);
  }

  console.error("\n--- diagnostics snapshot ---");
  for (const line of formatDiagnosticsSnapshot(diagnostics)) {
    console.error(line);
  }

  const diagnosticsIssues = collectDiagnosticsIssues(diagnostics, 20);
  if (diagnosticsIssues.length > 0) {
    console.error("\n--- structured diagnostics recent events ---");
    for (const issue of diagnosticsIssues) {
      console.error(issue);
    }
  }

  for (const [unit, content] of Object.entries(contents)) {
    if (content === null) {
      continue;
    }

    const readableIssues = collectReadableIssues(content, 20);
    if (readableIssues.length === 0) {
      continue;
    }

    console.error(`\n--- ${logs[unit]} (warn/error entries) ---`);
    for (const issue of readableIssues) {
      console.error(issue);
    }
  }

  process.exitCode = 1;
}

async function main() {
  const { mode, captureDir } = parseArgs(process.argv.slice(2));
  const context = createCheckContext(mode);

  try {
    await verifyRuntime(context);
  } finally {
    await captureLogs(context, captureDir);
  }
}

await main();
