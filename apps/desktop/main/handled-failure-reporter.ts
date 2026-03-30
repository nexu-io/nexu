import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import * as Sentry from "@sentry/electron/main";
import { app } from "electron";
import type { RuntimeEvent } from "../shared/host";
import type { DesktopRuntimeConfig } from "../shared/runtime-config";
import { exportDiagnosticsToFile } from "./diagnostics-export";
import type { RuntimeOrchestrator } from "./runtime/daemon-supervisor";
import { writeDesktopMainLog } from "./runtime/runtime-logger";

function getHandledFailureZipPath(actionId: string | null): string {
  const suffix = actionId ?? `${Date.now()}`;
  return resolve(
    app.getPath("temp"),
    "nexu-handled-failures",
    `openclaw-process-exited-${suffix}.zip`,
  );
}

function shouldReportOpenclawHandledFailure(
  runtimeEvent: Extract<RuntimeEvent, { type: "runtime:unit-log" }>,
): boolean {
  if (runtimeEvent.unitId !== "openclaw") {
    return false;
  }

  if (runtimeEvent.entry.reasonCode === "process_exited") {
    return true;
  }

  if (runtimeEvent.entry.reasonCode !== "launchd_log_line") {
    return false;
  }

  return (
    runtimeEvent.entry.message.includes("signal SIGTERM received") ||
    runtimeEvent.entry.message.includes("received SIGTERM; shutting down")
  );
}

export function registerHandledFailureReporter({
  orchestrator,
  runtimeConfig,
}: {
  orchestrator: RuntimeOrchestrator;
  runtimeConfig: DesktopRuntimeConfig;
}): () => void {
  let uploadInFlight = false;

  return orchestrator.subscribe((runtimeEvent) => {
    if (runtimeEvent.type !== "runtime:unit-log") {
      return;
    }

    if (!shouldReportOpenclawHandledFailure(runtimeEvent)) {
      return;
    }

    if (!Sentry.isInitialized()) {
      return;
    }

    if (uploadInFlight) {
      return;
    }

    uploadInFlight = true;

    void reportHandledFailure({
      orchestrator,
      runtimeConfig,
      runtimeEvent,
    }).finally(() => {
      uploadInFlight = false;
    });
  });
}

async function reportHandledFailure({
  orchestrator,
  runtimeConfig,
  runtimeEvent,
}: {
  orchestrator: RuntimeOrchestrator;
  runtimeConfig: DesktopRuntimeConfig;
  runtimeEvent: Extract<RuntimeEvent, { type: "runtime:unit-log" }>;
}): Promise<void> {
  const zipPath = getHandledFailureZipPath(runtimeEvent.entry.actionId);
  const runtimeState = orchestrator.getRuntimeState();
  const openclawUnit = runtimeState.units.find(
    (unit) => unit.id === "openclaw",
  );

  try {
    const { warnings } = await exportDiagnosticsToFile({
      orchestrator,
      runtimeConfig,
      outputPath: zipPath,
    });
    const zipData = await readFile(zipPath);

    Sentry.withScope((scope) => {
      scope.setLevel("error");
      scope.setTag("nexu.handled_failure", "true");
      scope.setTag("nexu.handled_failure_kind", "openclaw_process_exited");
      scope.setTag("nexu.runtime_unit", runtimeEvent.unitId);
      scope.setTag("nexu.runtime_reason_code", runtimeEvent.entry.reasonCode);
      scope.setTag(
        "nexu.runtime_trigger_source",
        runtimeEvent.entry.reasonCode,
      );

      if (runtimeEvent.entry.actionId) {
        scope.setTag("nexu.runtime_action_id", runtimeEvent.entry.actionId);
      }

      scope.setContext("handled_failure", {
        message: runtimeEvent.entry.message,
        ts: runtimeEvent.entry.ts,
        logId: runtimeEvent.entry.id,
        unitId: runtimeEvent.unitId,
        actionId: runtimeEvent.entry.actionId,
        exitCode: openclawUnit?.exitCode ?? null,
        phase: openclawUnit?.phase ?? null,
        warnings,
      });
      scope.addAttachment({
        filename: "nexu-diagnostics.zip",
        data: zipData,
        contentType: "application/zip",
      });

      Sentry.captureMessage("desktop.handled_failure.openclaw_process_exited");
    });

    await Sentry.flush(5000);

    writeDesktopMainLog({
      source: "handled-failure-reporter",
      stream: "stdout",
      kind: "lifecycle",
      message: `reported handled failure for openclaw process exit attachment=${zipPath}`,
      logFilePath: null,
    });
  } catch (error) {
    writeDesktopMainLog({
      source: "handled-failure-reporter",
      stream: "stderr",
      kind: "lifecycle",
      message: `failed to report handled failure: ${
        error instanceof Error ? error.message : String(error)
      }`,
      logFilePath: null,
    });
  } finally {
    await rm(zipPath, { force: true }).catch(() => {});
  }
}
