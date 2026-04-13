import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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

type UpdateCapability = {
  downloadMode: "in-app" | "external" | "none";
  applyMode: "in-app" | "redirect" | "external-installer" | "none";
};

export type UpdateState = {
  phase: UpdatePhase;
  version: string | null;
  percent: number;
  errorMessage: string | null;
  capability: UpdateCapability | null;
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
  const bridge = (window as unknown as NexuWindow).nexuHost;
  const [pendingCheck, setPendingCheck] = useState(false);
  const [userInitiatedCheck, setUserInitiatedCheck] = useState(false);
  const userInitiatedCheckRef = useRef(false);
  const [state, setState] = useState<UpdateState>({
    phase: "idle",
    version: null,
    percent: 0,
    errorMessage: null,
    capability: null,
  });

  useEffect(() => {
    userInitiatedCheckRef.current = userInitiatedCheck;
  }, [userInitiatedCheck]);

  useEffect(() => {
    const host = (window as unknown as NexuWindow).nexuHost;
    if (!host) return;
    let cancelled = false;

    // Query capability
    void host
      .invoke("update:get-capability", undefined)
      .then((result) => {
        if (!cancelled) {
          const cap = result as UpdateCapability | null;
          setState((prev) => ({ ...prev, capability: cap }));
        }
      })
      .catch(() => {});

    // Query current update status (catches background downloads that
    // completed before this component mounted). Also starts polling while
    // a background download is in progress so the settings page shows
    // live progress without switching the main process to foreground mode
    // (which would broadcast events to the desktop shell banner too).
    const pollStatus = () => {
      void host
        .invoke("update:get-status", undefined)
        .then((result) => {
          if (cancelled) return;
          const status = result as {
            phase: "idle" | "downloading" | "ready";
            version: string | null;
            percent: number;
          };
          if (
            (status.phase === "ready" || status.phase === "downloading") &&
            status.version
          ) {
            setState((prev) => ({
              ...prev,
              phase: status.phase,
              version: status.version,
              percent: status.percent,
            }));
          }
        })
        .catch(() => {});
    };

    pollStatus();
    const pollTimer = setInterval(pollStatus, 1000);

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
    };
  }, []);

  useEffect(() => {
    if (!pendingCheck || state.capability === null) {
      return;
    }

    setPendingCheck(false);
    setUserInitiatedCheck(true);
    void bridge?.invoke("update:check", undefined).catch(() => {
      /* errors via event */
    });
  }, [bridge, pendingCheck, state.capability]);

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
        setUserInitiatedCheck(false);
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
        if (userInitiatedCheckRef.current) {
          toast.success("Already up to date");
          setUserInitiatedCheck(false);
        }
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
        setUserInitiatedCheck(false);
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
        setUserInitiatedCheck(false);
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

  const check = useCallback(async () => {
    setState((prev) => ({
      ...prev,
      phase: "checking",
      errorMessage: null,
    }));
    setUserInitiatedCheck(true);

    if (state.capability === null) {
      setPendingCheck(true);
      return;
    }

    try {
      await bridge?.invoke("update:check", undefined);
    } catch {
      /* errors via event */
    }
  }, [bridge, state.capability]);

  const download = useCallback(async () => {
    if (state.capability?.downloadMode === "external") {
      // External download opens the installer URL in the system browser.
      // Don't show "downloading" state — the browser handles the download.
      try {
        await bridge?.invoke("update:download", undefined);
      } catch {
        /* errors via event */
      }
      return;
    }
    // In-app download: show downloading state before the IPC round-trip.
    // Keep existing percent if already downloading (e.g. resumed from background).
    setState((prev) => ({
      ...prev,
      phase: "downloading",
      percent: prev.phase === "downloading" ? prev.percent : 0,
    }));
    try {
      await bridge?.invoke("update:download", undefined);
    } catch {
      /* errors via event */
    }
  }, [bridge, state.capability]);

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
