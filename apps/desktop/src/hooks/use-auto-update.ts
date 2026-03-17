import { useCallback, useEffect, useState } from "react";
import { checkForUpdate, downloadUpdate, installUpdate } from "../lib/host-api";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export type UpdateState = {
  phase: UpdatePhase;
  version: string | null;
  releaseNotes: string | null;
  percent: number;
  errorMessage: string | null;
};

export function useAutoUpdate() {
  const [state, setState] = useState<UpdateState>({
    phase: "idle",
    version: null,
    releaseNotes: null,
    percent: 0,
    errorMessage: null,
  });

  useEffect(() => {
    const updater = window.nexuUpdater;
    if (!updater) return;

    const disposers: Array<() => void> = [];

    disposers.push(
      updater.onEvent("update:checking", () => {
        setState((prev) => ({
          ...prev,
          phase: "checking",
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
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:up-to-date", () => {
        setState((prev) => ({ ...prev, phase: "idle" }));
      }),
    );

    disposers.push(
      updater.onEvent("update:progress", (data) => {
        setState((prev) => ({
          ...prev,
          phase: "downloading",
          percent: data.percent,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:downloaded", (data) => {
        setState((prev) => ({
          ...prev,
          phase: "ready",
          version: data.version,
          percent: 100,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:error", (data) => {
        setState((prev) => ({
          ...prev,
          phase: "error",
          errorMessage: data.message,
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
    try {
      await checkForUpdate();
    } catch {
      // Errors are delivered via the update:error event
    }
  }, []);

  const download = useCallback(async () => {
    try {
      await downloadUpdate();
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
      phase: "idle",
      errorMessage: null,
    }));
  }, []);

  return { ...state, check, download, install, dismiss };
}
