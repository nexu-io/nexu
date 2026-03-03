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

function buildProbeArgs(probeType: GatewayProbeType): string[] {
  const args: string[] = [];

  if (env.OPENCLAW_PROFILE) {
    args.push("--profile", env.OPENCLAW_PROFILE);
  }

  if (probeType === "liveness") {
    args.push(
      "health",
      "--json",
      "--timeout",
      String(env.RUNTIME_GATEWAY_CLI_TIMEOUT_MS),
    );
    return args;
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

async function runCliProbe(
  probeType: GatewayProbeType,
): Promise<GatewayProbeResult> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const args = buildProbeArgs(probeType);

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
      probeType,
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
        probeType,
        checkedAt,
        latencyMs,
        errorCode: "parse_error",
      };
    }
  } catch {
    return {
      ok: false,
      probeType,
      checkedAt,
      latencyMs,
      errorCode: "parse_error",
    };
  }

  return {
    ok: true,
    probeType,
    checkedAt,
    latencyMs,
  };
}

export async function probeGatewayLiveness(): Promise<GatewayProbeResult> {
  return runCliProbe("liveness");
}

export async function probeGatewayDeepHealth(): Promise<GatewayProbeResult> {
  return runCliProbe("deep");
}

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
