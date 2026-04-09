import { useCallback, useEffect, useState } from "react";
import type { DesktopUpdateCapability } from "../../shared/host";
import type { DesktopUpdateExperience } from "../../shared/update-policy";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateCapability,
  installUpdate,
} from "../lib/host-api";
import { resolveLocale } from "../lib/i18n";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "error";

export type UpdateState = {
  capability: DesktopUpdateCapability | null;
  phase: UpdatePhase;
  version: string | null;
  releaseNotes: string | null;
  actionUrl: string | null;
  percent: number;
  errorMessage: string | null;
  dismissed: boolean;
  userInitiated: boolean;
};

function normalizeUpdateErrorMessage(
  message: string,
  experience: DesktopUpdateExperience,
): string {
  if (experience !== "local-test-feed") {
    return message;
  }

  if (/404\s+Not\s+Found/i.test(message)) {
    return resolveLocale({
      en: "The test update feed is unavailable. Check the guide and verify your NEXU_UPDATE_FEED_URL configuration.",
      zh: "测试更新源不可用。请查看说明文档，并检查 NEXU_UPDATE_FEED_URL 配置是否正确。",
    });
  }

  return message;
}

export function restorePhaseAfterInstall(
  state: UpdateState,
  previousPhase: Exclude<UpdatePhase, "installing">,
): UpdateState {
  return state.phase === "installing"
    ? { ...state, phase: previousPhase }
    : state;
}

export function useAutoUpdate(options?: {
  experience?: DesktopUpdateExperience;
}) {
  const experience = options?.experience ?? "normal";
  const [state, setState] = useState<UpdateState>({
    capability: null,
    phase: "idle",
    version: null,
    releaseNotes: null,
    actionUrl: null,
    percent: 0,
    errorMessage: null,
    dismissed: false,
    userInitiated: false,
  });

  useEffect(() => {
    let cancelled = false;

    void getUpdateCapability()
      .then((capability) => {
        if (cancelled) {
          return;
        }
        setState((prev) => ({ ...prev, capability }));
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setState((prev) => ({ ...prev, capability: null }));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const updater = window.nexuUpdater;
    if (!updater) return;

    const disposers: Array<() => void> = [];

    disposers.push(
      updater.onEvent("update:checking", () => {
        setState((prev) => ({
          ...prev,
          phase:
            prev.userInitiated && prev.phase !== "installing"
              ? "checking"
              : prev.phase,
          errorMessage: null,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:available", (data) => {
        setState((prev) => ({
          ...prev,
          phase: "available",
          version: data.version,
          releaseNotes: data.releaseNotes ?? null,
          actionUrl: data.actionUrl ?? null,
          userInitiated: false,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:up-to-date", () => {
        setState((prev) => ({
          ...prev,
          phase: prev.userInitiated ? "up-to-date" : "idle",
          errorMessage: null,
          actionUrl: null,
          userInitiated: false,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:progress", (data) => {
        setState((prev) => ({
          ...prev,
          phase: "downloading",
          percent: data.percent,
          userInitiated: false,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:downloaded", (data) => {
        setState((prev) => ({
          ...prev,
          phase: "ready",
          version: data.version,
          actionUrl: null,
          percent: 100,
          userInitiated: false,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:error", (data) => {
        setState((prev) => ({
          ...prev,
          phase: "error",
          errorMessage: normalizeUpdateErrorMessage(data.message, experience),
          userInitiated: false,
        }));
      }),
    );

    return () => {
      for (const dispose of disposers) {
        dispose();
      }
    };
  }, [experience]);

  useEffect(() => {
    if (state.phase !== "up-to-date") {
      return;
    }

    const timer = window.setTimeout(() => {
      setState((prev) =>
        prev.phase === "up-to-date"
          ? { ...prev, phase: "idle", userInitiated: false }
          : prev,
      );
    }, 2800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [state.phase]);

  const check = useCallback(async () => {
    if (!state.capability?.check) {
      setState((prev) => ({
        ...prev,
        phase: "idle",
        userInitiated: false,
      }));
      return;
    }

    setState((prev) => ({
      ...prev,
      phase: "checking",
      errorMessage: null,
      dismissed: false,
      userInitiated: true,
    }));
    try {
      await checkForUpdate();
    } catch {
      // Errors are delivered via the update:error event
    }
  }, [state.capability]);

  const download = useCallback(async () => {
    if (state.capability?.downloadMode !== "in-app") {
      if (state.capability?.downloadMode === "external") {
        try {
          await downloadUpdate();
        } catch {
          // Errors are delivered via the update:error event
        }
      }
      return;
    }

    // Immediately switch to downloading state so the UI shows progress
    // instead of leaving the Download button unresponsive while waiting
    // for the first update:progress event from electron-updater.
    setState((prev) => ({ ...prev, phase: "downloading", percent: 0 }));
    try {
      await downloadUpdate();
    } catch {
      // Errors are delivered via the update:error event
    }
  }, [state.capability]);

  const install = useCallback(async () => {
    if (state.capability?.applyMode !== "in-app") {
      return;
    }

    let previousPhase: Exclude<UpdatePhase, "installing"> = "ready";

    setState((prev) => {
      previousPhase = prev.phase === "installing" ? previousPhase : prev.phase;
      return { ...prev, phase: "installing" };
    });
    try {
      await installUpdate();
      setState((prev) => restorePhaseAfterInstall(prev, previousPhase));
    } catch {
      // Errors are delivered via the update:error event
    }
  }, [state.capability]);

  const dismiss = useCallback(() => {
    setState((prev) => ({
      ...prev,
      dismissed: true,
    }));
  }, []);

  const undismiss = useCallback(() => {
    setState((prev) => ({
      ...prev,
      dismissed: false,
    }));
  }, []);

  return { ...state, check, download, install, dismiss, undismiss };
}
