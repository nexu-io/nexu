import { useCallback, useEffect, useState } from "react";

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
  percent: number;
  errorMessage: string | null;
};

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
    // biome-ignore lint/suspicious/noExplicitAny: bridge injected at runtime
    const updater = (window as any).nexuUpdater;
    if (!updater) return;

    const disposers: Array<() => void> = [];

    disposers.push(
      updater.onEvent("update:checking", () => {
        setState((prev: UpdateState) => {
          // Don't regress from downloading/ready (downloadUpdate re-fires check events)
          if (prev.phase === "downloading" || prev.phase === "ready")
            return prev;
          return { ...prev, phase: "checking", errorMessage: null };
        });
      }),
    );

    disposers.push(
      updater.onEvent(
        "update:available",
        (data: { version: string; releaseNotes?: string }) => {
          setState((prev: UpdateState) => {
            if (prev.phase === "downloading" || prev.phase === "ready")
              return prev;
            return { ...prev, phase: "available", version: data.version };
          });
        },
      ),
    );

    disposers.push(
      updater.onEvent("update:up-to-date", () => {
        setState((prev: UpdateState) => ({ ...prev, phase: "idle" }));
      }),
    );

    disposers.push(
      updater.onEvent("update:progress", (data: { percent: number }) => {
        setState((prev: UpdateState) => ({
          ...prev,
          phase: "downloading",
          percent: data.percent,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:downloaded", (data: { version: string }) => {
        setState((prev: UpdateState) => ({
          ...prev,
          phase: "ready",
          version: data.version,
          percent: 100,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:error", (data: { message: string }) => {
        setState((prev: UpdateState) => ({
          ...prev,
          phase: "error",
          errorMessage: data.message,
        }));
      }),
    );

    return () => {
      for (const dispose of disposers) dispose();
    };
  }, []);

  // biome-ignore lint/suspicious/noExplicitAny: bridge injected at runtime
  const bridge = (window as any).nexuHost;

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
    try {
      await bridge?.invoke("update:install", undefined);
    } catch {
      /* errors via event */
    }
  }, [bridge]);

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, phase: "idle", errorMessage: null }));
  }, []);

  return { ...state, check, download, install, dismiss };
}
