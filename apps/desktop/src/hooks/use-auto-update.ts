import { useCallback, useEffect, useRef, useState } from "react";
import { checkForUpdate, downloadUpdate, installUpdate } from "../lib/host-api";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
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
  dismissed: boolean;
  userInitiated: boolean;
};

export function useAutoUpdate() {
  const checkInFlightRef = useRef<Promise<void> | null>(null);
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
        setState((prev) => ({
          ...prev,
          phase: prev.userInitiated ? "checking" : prev.phase,
          errorMessage: null,
          ...(prev.userInitiated ? { dismissed: false } : {}),
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
          userInitiated: false,
          dismissed: false,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:up-to-date", () => {
        setState((prev) => ({
          ...prev,
          phase: prev.userInitiated ? "up-to-date" : "idle",
          errorMessage: null,
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
          dismissed: false,
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

  const closeDialog = useCallback(() => {
    setState((prev) =>
      prev.phase === "checking" || prev.phase === "up-to-date"
        ? { ...prev, phase: "idle", userInitiated: false }
        : prev,
    );
  }, []);

  const check = useCallback(async () => {
    if (checkInFlightRef.current) {
      return checkInFlightRef.current;
    }

    setState((prev) => ({
      ...prev,
      phase: "checking",
      errorMessage: null,
      dismissed: false,
      userInitiated: true,
    }));
    const checkPromise = (async () => {
      try {
        await checkForUpdate();
      } catch {
        // Errors are delivered via the update:error event
      } finally {
        checkInFlightRef.current = null;
      }
    })();

    checkInFlightRef.current = checkPromise;
    return checkPromise;
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
      dismissed: true,
    }));
  }, []);

  const undismiss = useCallback(() => {
    setState((prev) => ({
      ...prev,
      dismissed: false,
    }));
  }, []);

  return {
    ...state,
    check,
    download,
    install,
    dismiss,
    undismiss,
    closeDialog,
  };
}
