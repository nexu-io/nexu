import { useCallback, useEffect, useState } from "react";
import { checkForUpdate, installUpdate } from "../lib/host-api";

export type UpdatePhase = "idle" | "ready" | "error";

export type UpdateState = {
  phase: UpdatePhase;
  version: string | null;
  releaseNotes: string | null;
  percent: number;
  errorMessage: string | null;
  dismissed: boolean;
  userInitiated: boolean;
};

export function useAutoUpdate() {
  const [state, setState] = useState<UpdateState>({
    phase: "idle",
    version: null,
    releaseNotes: null,
    percent: 0,
    errorMessage: null,
    dismissed: false,
    userInitiated: false,
  });

  useEffect(() => {
    const updater = window.nexuUpdater;
    if (!updater) return;

    const disposers: Array<() => void> = [];

    disposers.push(
      updater.onEvent("update:checking", () => {
        setState((prev) => ({ ...prev, errorMessage: null }));
      }),
    );

    disposers.push(
      updater.onEvent("update:available", (data) => {
        setState((prev) => ({
          ...prev,
          version: data.version,
          releaseNotes: data.releaseNotes ?? null,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:up-to-date", () => {
        setState((prev) => ({
          ...prev,
          errorMessage: null,
          userInitiated: false,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:progress", (data) => {
        setState((prev) => ({ ...prev, percent: data.percent }));
      }),
    );

    disposers.push(
      updater.onEvent("update:downloaded", (data) => {
        setState((prev) => ({
          ...prev,
          phase: "ready",
          version: data.version,
          percent: 100,
          userInitiated: false,
          dismissed: false,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:error", (data) => {
        setState((prev) => ({
          ...prev,
          phase: "error",
          errorMessage: data.message,
          userInitiated: false,
          dismissed: false,
        }));
      }),
    );

    return () => {
      for (const dispose of disposers) {
        dispose();
      }
    };
  }, []);

  const check = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      errorMessage: null,
      userInitiated: true,
    }));
    try {
      await checkForUpdate();
    } catch {
      // Errors are delivered via the update:error event
    }
  }, []);

  const install = useCallback(async () => {
    try {
      await installUpdate();
    } catch {
      // Errors are delivered via the update:error event
    }
  }, []);

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

  return { ...state, check, install, dismiss, undismiss };
}
