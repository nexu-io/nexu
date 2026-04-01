import { useCallback, useEffect, useState } from "react";

type UpdateBridge = {
  onEvent: (
    event: string,
    listener: (data?: {
      version?: string;
      percent?: number;
      message?: string;
      releaseNotes?: string;
    }) => void,
  ) => () => void;
  invoke: (command: string, payload: undefined) => Promise<unknown>;
};

type HostBridge = {
  invoke: (command: string, payload: undefined) => Promise<unknown>;
};

type NexuWindow = Window & {
  nexuUpdater?: UpdateBridge;
  nexuHost?: HostBridge;
};

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "error";

export type UpdateState = {
  phase: UpdatePhase;
  version: string | null;
  percent: number;
  errorMessage: string | null;
};

export function restorePhaseAfterInstall(
  state: UpdateState,
  previousPhase: Exclude<UpdatePhase, "installing">,
): UpdateState {
  return state.phase === "installing"
    ? { ...state, phase: previousPhase }
    : state;
}

/**
 * Auto-update hook that bridges to the Electron updater when running
 * inside the desktop shell. In the web-only build, `window.nexuUpdater`
 * is undefined and the hook stays at phase "idle".
 */
export function useAutoUpdate() {
  const [state, setState] = useState<UpdateState>({
    phase: "idle",
    version: null,
    percent: 0,
    errorMessage: null,
  });

  useEffect(() => {
    const updater = (window as unknown as NexuWindow).nexuUpdater;
    if (!updater) return;

    const disposers: Array<() => void> = [];

    disposers.push(
      updater.onEvent("update:checking", () => {
        setState((prev: UpdateState) => {
          // Don't regress from downloading/ready (downloadUpdate re-fires check events)
          if (
            prev.phase === "downloading" ||
            prev.phase === "installing" ||
            prev.phase === "ready"
          )
            return prev;
          return { ...prev, phase: "checking", errorMessage: null };
        });
      }),
    );

    disposers.push(
      updater.onEvent("update:available", (data) => {
        setState((prev: UpdateState) => {
          if (
            prev.phase === "downloading" ||
            prev.phase === "installing" ||
            prev.phase === "ready"
          )
            return prev;
          return {
            ...prev,
            phase: "available",
            version: data?.version ?? prev.version,
          };
        });
      }),
    );

    disposers.push(
      updater.onEvent("update:up-to-date", () => {
        setState((prev: UpdateState) => ({ ...prev, phase: "idle" }));
      }),
    );

    disposers.push(
      updater.onEvent("update:progress", (data) => {
        setState((prev: UpdateState) => ({
          ...prev,
          phase: "downloading",
          percent: data?.percent ?? prev.percent,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:downloaded", (data) => {
        setState((prev: UpdateState) => ({
          ...prev,
          phase: "ready",
          version: data?.version ?? prev.version,
          percent: 100,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:error", (data) => {
        setState((prev: UpdateState) => ({
          ...prev,
          phase: "error",
          errorMessage: data?.message ?? prev.errorMessage,
        }));
      }),
    );

    return () => {
      for (const dispose of disposers) dispose();
    };
  }, []);

  const bridge = (window as unknown as NexuWindow).nexuHost;

  const check = useCallback(async () => {
    try {
      await bridge?.invoke("update:check", undefined);
    } catch {
      /* errors via event */
    }
  }, [bridge]);

  const download = useCallback(async () => {
    // Immediately show downloading state before the IPC round-trip
    setState((prev) => ({ ...prev, phase: "downloading", percent: 0 }));
    try {
      await bridge?.invoke("update:download", undefined);
    } catch {
      /* errors via event */
    }
  }, [bridge]);

  const install = useCallback(async () => {
    let previousPhase: Exclude<UpdatePhase, "installing"> = "ready";

    setState((prev) => {
      previousPhase = prev.phase === "installing" ? previousPhase : prev.phase;
      return { ...prev, phase: "installing" };
    });
    try {
      await bridge?.invoke("update:install", undefined);
      setState((prev) => restorePhaseAfterInstall(prev, previousPhase));
    } catch {
      /* errors via event */
    }
  }, [bridge]);

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, phase: "idle", errorMessage: null }));
  }, []);

  return { ...state, check, download, install, dismiss };
}
