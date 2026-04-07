import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const scriptFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFilePath), "../..");
const runtimePortsPath = path.join(
  repoRoot,
  ".tmp",
  "launchd",
  "runtime-ports.json",
);

function readRuntimeProbeDefaults() {
  if (!existsSync(runtimePortsPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(runtimePortsPath, "utf8"));
    const controllerPort =
      typeof parsed.controllerPort === "number" ? parsed.controllerPort : null;
    const nexuHome =
      typeof parsed.nexuHome === "string" && parsed.nexuHome.length > 0
        ? parsed.nexuHome
        : null;
    const openclawStateDir =
      typeof parsed.openclawStateDir === "string" &&
      parsed.openclawStateDir.length > 0
        ? parsed.openclawStateDir
        : null;

    return {
      controllerUrl:
        controllerPort !== null ? `http://127.0.0.1:${controllerPort}` : null,
      configPath:
        nexuHome !== null
          ? path.join(nexuHome, "runtime", "openclaw", "state", "openclaw.json")
          : null,
      stateDir: openclawStateDir,
    };
  } catch {
    return null;
  }
}

const runtimeProbeDefaults = readRuntimeProbeDefaults();

const defaultOptions = {
  configPath:
    runtimeProbeDefaults?.configPath ??
    path.join(
      repoRoot,
      ".tmp",
      "desktop",
      "nexu-home",
      "runtime",
      "openclaw",
      "state",
      "openclaw.json",
    ),
  stateDir:
    runtimeProbeDefaults?.stateDir ??
    path.join(
      repoRoot,
      ".tmp",
      "desktop",
      "electron",
      "user-data",
      "runtime",
      "openclaw",
      "state",
    ),
  controllerUrl:
    runtimeProbeDefaults?.controllerUrl ?? "http://127.0.0.1:50800",
  sessionId: "local-probe",
  provider: null,
  model: null,
  message: "Hello from local model probe",
  timeoutSec: 60,
};

async function readJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} from ${url}: ${JSON.stringify(payload)}`,
    );
  }

  return payload;
}

function getProviderFromModelId(modelId) {
  const slashIndex = modelId.lastIndexOf("/");
  return slashIndex === -1 ? modelId : modelId.slice(0, slashIndex);
}

function getModelNameFromModelId(modelId) {
  const slashIndex = modelId.lastIndexOf("/");
  return slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
}

function resolveTargetModel(models, currentModelId, provider, model) {
  if (!provider && !model) {
    const currentModel = models.find((entry) => entry.id === currentModelId);
    if (!currentModel) {
      throw new Error(`Current default model not found: ${currentModelId}`);
    }
    return currentModel;
  }

  const filteredByProvider = provider
    ? models.filter(
        (entry) =>
          entry.provider === provider ||
          getProviderFromModelId(entry.id) === provider,
      )
    : models;

  if (filteredByProvider.length === 0) {
    throw new Error(`No models found for provider: ${provider}`);
  }

  if (!model) {
    if (filteredByProvider.length !== 1) {
      throw new Error(
        `Provider ${provider} has ${filteredByProvider.length} models; pass --model too`,
      );
    }
    return filteredByProvider[0];
  }

  const exactIdMatch = filteredByProvider.find((entry) => entry.id === model);
  if (exactIdMatch) {
    return exactIdMatch;
  }

  const exactNameMatches = filteredByProvider.filter(
    (entry) =>
      entry.name === model || getModelNameFromModelId(entry.id) === model,
  );

  if (exactNameMatches.length === 1) {
    return exactNameMatches[0];
  }

  if (exactNameMatches.length > 1) {
    throw new Error(
      `Model ${model} is ambiguous for provider ${provider ?? "<any>"}`,
    );
  }

  throw new Error(
    `No model match found for provider=${provider ?? "<any>"} model=${model}`,
  );
}

function parseArgs(argv) {
  const options = { ...defaultOptions };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg === "--config-path") {
      options.configPath = path.resolve(argv[index + 1] ?? options.configPath);
      index += 1;
      continue;
    }

    if (arg === "--state-dir") {
      options.stateDir = path.resolve(argv[index + 1] ?? options.stateDir);
      index += 1;
      continue;
    }

    if (arg === "--controller-url") {
      options.controllerUrl = argv[index + 1] ?? options.controllerUrl;
      index += 1;
      continue;
    }

    if (arg === "--session-id") {
      options.sessionId = argv[index + 1] ?? options.sessionId;
      index += 1;
      continue;
    }

    if (arg === "--provider") {
      options.provider = argv[index + 1] ?? options.provider;
      index += 1;
      continue;
    }

    if (arg === "--model") {
      options.model = argv[index + 1] ?? options.model;
      index += 1;
      continue;
    }

    if (arg === "--message") {
      options.message = argv[index + 1] ?? options.message;
      index += 1;
      continue;
    }

    if (arg === "--timeout-sec") {
      const timeoutSec = Number(argv[index + 1] ?? options.timeoutSec);
      if (!Number.isNaN(timeoutSec) && timeoutSec > 0) {
        options.timeoutSec = timeoutSec;
      }
      index += 1;
    }
  }

  return options;
}

function printUsage() {
  console.log(
    [
      "Model Call Probe",
      "",
      "Usage:",
      "  pnpm probe:model -- [options]",
      "",
      "Options:",
      "  --config-path  OpenClaw config path",
      "  --state-dir    OpenClaw state directory",
      "  --controller-url Controller base URL for model selection",
      "  --session-id   Session id for the local turn",
      "  --provider     Provider key to test (optional)",
      "  --model        Model id or model name to test (optional)",
      "  --message      User message",
      "  --timeout-sec  Agent timeout in seconds",
    ].join("\n"),
  );
}

function extractAssistantText(payload) {
  const result = payload?.result;
  const payloads = result?.payloads;
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return null;
  }

  return payloads
    .map((entry) => (typeof entry?.text === "string" ? entry.text : ""))
    .join("\n")
    .trim();
}

function parseJsonFromStdout(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    const trimmed = stdout.trim();
    const lastJsonStart = Math.max(
      trimmed.lastIndexOf("\n{"),
      trimmed.lastIndexOf("\n["),
    );
    const firstJsonStart = (() => {
      const objectStart = trimmed.indexOf("{");
      const arrayStart = trimmed.indexOf("[");
      if (objectStart === -1) return arrayStart;
      if (arrayStart === -1) return objectStart;
      return Math.min(objectStart, arrayStart);
    })();
    const candidate =
      lastJsonStart >= 0
        ? trimmed.slice(lastJsonStart + 1)
        : trimmed.startsWith("{") || trimmed.startsWith("[")
          ? trimmed
          : firstJsonStart >= 0
            ? trimmed.slice(firstJsonStart)
            : "";

    if (candidate) {
      try {
        return JSON.parse(candidate);
      } catch {
        // fall through to original error
      }
    }

    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  const command = path.join(repoRoot, "openclaw-wrapper");
  const args = [
    "agent",
    "--session-id",
    options.sessionId,
    "--message",
    options.message,
    "--json",
    "--timeout",
    String(options.timeoutSec),
  ];

  let originalModelId = null;

  try {
    const [modelsResponse, defaultModelResponse] = await Promise.all([
      readJson(`${options.controllerUrl}/api/v1/models`),
      readJson(`${options.controllerUrl}/api/internal/desktop/default-model`),
    ]);

    const models = Array.isArray(modelsResponse?.models)
      ? modelsResponse.models
      : [];
    originalModelId = defaultModelResponse?.modelId ?? null;

    const selectedModel = resolveTargetModel(
      models,
      originalModelId,
      options.provider,
      options.model,
    );

    if (selectedModel.id !== originalModelId) {
      await readJson(
        `${options.controllerUrl}/api/internal/desktop/default-model`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId: selectedModel.id }),
        },
      );
    }

    console.log(`[probe][info] provider=${selectedModel.provider}`);
    console.log(`[probe][info] model=${selectedModel.id}`);

    const { stdout } = await execFileAsync(command, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        OPENCLAW_CONFIG_PATH: options.configPath,
        OPENCLAW_STATE_DIR: options.stateDir,
      },
      maxBuffer: 1024 * 1024 * 10,
    });

    const payload = parseJsonFromStdout(stdout);
    const assistantText = extractAssistantText(payload);

    if (!assistantText) {
      console.error("[probe][fail] Missing assistant response text");
      process.exitCode = 1;
      return;
    }

    console.log("[probe][ok] model call succeeded");
    console.log(assistantText);
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr ?? "")
        : "";
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[probe][fail] ${stderr || message}`.trim());
    process.exitCode = 1;
  } finally {
    if (originalModelId) {
      try {
        await readJson(
          `${options.controllerUrl}/api/internal/desktop/default-model`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelId: originalModelId }),
          },
        );
      } catch {
        console.error(
          `[probe][warn] failed to restore default model: ${originalModelId}`,
        );
      }
    }
  }
}

await main();
