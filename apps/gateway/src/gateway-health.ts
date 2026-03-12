import { execFile } from "node:child_process";
import type { ExecFileException } from "node:child_process";
import { env } from "./env.js";
import { GatewayError, logger } from "./log.js";
import type { GatewayProbeErrorCode } from "./state.js";
import { sleep } from "./utils.js";

export type GatewayProbeType = "liveness" | "deep";

export interface GatewayProbeSuccess {
  ok: true;
  probeType: GatewayProbeType;
  checkedAt: string;
  latencyMs: number;
}

export interface GatewayProbeFailure {
  ok: false;
  probeType: GatewayProbeType;
  checkedAt: string;
  latencyMs: number;
  errorCode: GatewayProbeErrorCode;
  exitCode?: number;
}

export type GatewayProbeResult = GatewayProbeSuccess | GatewayProbeFailure;

// ---------------------------------------------------------------------------
// HTTP-based liveness probe — hits /health on the gateway HTTP port.
// This avoids spawning a full Node.js CLI process (~240 MB) per check.
// ---------------------------------------------------------------------------

async function runHttpLivenessProbe(): Promise<GatewayProbeResult> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const url = `http://127.0.0.1:${env.RUNTIME_GATEWAY_HTTP_PROBE_PORT}/health`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      env.RUNTIME_GATEWAY_CLI_TIMEOUT_MS,
    );

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        probeType: "liveness",
        checkedAt,
        latencyMs,
        errorCode: "cli_exit_nonzero",
        exitCode: response.status,
      };
    }

    const body = (await response.json()) as Record<string, unknown>;
    if (body.ok !== true) {
      return {
        ok: false,
        probeType: "liveness",
        checkedAt,
        latencyMs,
        errorCode: "cli_exit_nonzero",
      };
    }

    return { ok: true, probeType: "liveness", checkedAt, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    return {
      ok: false,
      probeType: "liveness",
      checkedAt,
      latencyMs,
      errorCode: isAbort ? "cli_timeout" : "cli_spawn_error",
    };
  }
}

// ---------------------------------------------------------------------------
// CLI-based deep probe — still uses `openclaw status --deep` because the
// deep status data is only available via the WebSocket protocol, not HTTP.
// ---------------------------------------------------------------------------

function buildDeepProbeArgs(): string[] {
  const args: string[] = [];
  if (env.OPENCLAW_PROFILE) {
    args.push("--profile", env.OPENCLAW_PROFILE);
  }
  args.push(
    "status",
    "--deep",
    "--json",
    "--timeout",
    String(env.RUNTIME_GATEWAY_CLI_TIMEOUT_MS),
  );
  return args;
}

function classifyExecError(error: ExecFileException): {
  errorCode: GatewayProbeErrorCode;
  exitCode?: number;
} {
  if (error.killed) {
    return { errorCode: "cli_timeout" };
  }

  if (typeof error.code === "number") {
    return {
      errorCode: "cli_exit_nonzero",
      exitCode: error.code,
    };
  }

  return { errorCode: "cli_spawn_error" };
}

async function runCliDeepProbe(): Promise<GatewayProbeResult> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const args = buildDeepProbeArgs();

  const executionResult = await new Promise<
    | { ok: true; stdout: string }
    | {
        ok: false;
        errorCode: GatewayProbeErrorCode;
        exitCode?: number;
      }
  >((resolve) => {
    execFile(
      env.OPENCLAW_BIN,
      args,
      {
        timeout: env.RUNTIME_GATEWAY_CLI_TIMEOUT_MS,
        windowsHide: true,
        env: {
          ...process.env,
          OPENCLAW_LOG_LEVEL: "error",
        },
      },
      (error, stdout) => {
        if (error) {
          const classified = classifyExecError(error as ExecFileException);
          resolve({ ok: false, ...classified });
          return;
        }

        resolve({ ok: true, stdout });
      },
    );
  });

  const latencyMs = Date.now() - startedAt;
  if (!executionResult.ok) {
    return {
      ok: false,
      probeType: "deep",
      checkedAt,
      latencyMs,
      errorCode: executionResult.errorCode,
      exitCode: executionResult.exitCode,
    };
  }

  try {
    const parsed = JSON.parse(executionResult.stdout) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return {
        ok: false,
        probeType: "deep",
        checkedAt,
        latencyMs,
        errorCode: "parse_error",
      };
    }
  } catch {
    return {
      ok: false,
      probeType: "deep",
      checkedAt,
      latencyMs,
      errorCode: "parse_error",
    };
  }

  return { ok: true, probeType: "deep", checkedAt, latencyMs };
}

export async function probeGatewayLiveness(): Promise<GatewayProbeResult> {
  return runHttpLivenessProbe();
}

export async function probeGatewayDeepHealth(): Promise<GatewayProbeResult> {
  return runCliDeepProbe();
}

const MAX_READY_ATTEMPTS = 120; // give up after ~2 minutes

export async function waitGatewayReady(): Promise<void> {
  if (!env.RUNTIME_GATEWAY_PROBE_ENABLED) {
    return;
  }

  let attempt = 1;
  for (;;) {
    const result = await probeGatewayLiveness();
    if (result.ok) {
      logger.info(
        {
          event: "gateway_probe",
          probeType: result.probeType,
          latencyMs: result.latencyMs,
        },
        "gateway is ready",
      );
      return;
    }

    if (attempt >= MAX_READY_ATTEMPTS) {
      logger.error(
        {
          event: "gateway_ready_timeout",
          attempts: attempt,
          maxAttempts: MAX_READY_ATTEMPTS,
        },
        "gateway failed to become ready; continuing bootstrap",
      );
      return;
    }

    logger.warn(
      GatewayError.from(
        {
          source: "gateway-health/wait-ready",
          message: "gateway readiness probe failed; retrying",
          code: result.errorCode,
        },
        {
          event: "gateway_probe",
          probeType: result.probeType,
          attempt,
          latencyMs: result.latencyMs,
          exitCode: result.exitCode,
          retryInMs: 1000,
        },
      ).toJSON(),
      "gateway readiness probe failed; retrying",
    );

    attempt += 1;
    await sleep(1000);
  }
}
