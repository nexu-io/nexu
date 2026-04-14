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
  const trimmedMessage = message.trim();
  const localized = (en: string, zh: string) =>
    resolveLocale({
      en,
      zh,
    });

  if (
    /\b(ENOTFOUND|EAI_AGAIN|DNS|getaddrinfo)\b/i.test(trimmedMessage) ||
    /Could not resolve host/i.test(trimmedMessage)
  ) {
    return localized(
      "The update server address could not be resolved. Check your network or DNS settings and try again.",
      "无法解析更新服务器地址。请检查网络或 DNS 设置后重试。",
    );
  }

  if (
    /\b(ETIMEDOUT|ERR_CONNECTION_TIMED_OUT|timeout)\b/i.test(trimmedMessage)
  ) {
    return localized(
      "The update request timed out. Check your network connection and try again.",
      "更新请求超时。请检查网络连接后重试。",
    );
  }

  if (
    /\b(ECONNRESET|ECONNABORTED|socket hang up|network changed)\b/i.test(
      trimmedMessage,
    )
  ) {
    return localized(
      "The network connection was interrupted while checking for updates. Try again after the connection stabilizes.",
      "检查更新时网络连接中断。请等网络稳定后重试。",
    );
  }

  if (
    /\b(ENETUNREACH|EHOSTUNREACH|ENETDOWN|ERR_INTERNET_DISCONNECTED|offline)\b/i.test(
      trimmedMessage,
    )
  ) {
    return localized(
      "No network connection is available right now. Reconnect and try the update again.",
      "当前网络不可用。请恢复联网后再次尝试更新。",
    );
  }

  if (/\b403\b/i.test(trimmedMessage)) {
    return localized(
      "The update server rejected the request. Check network restrictions or proxy settings and try again.",
      "更新服务器拒绝了请求。请检查网络限制或代理设置后重试。",
    );
  }

  if (experience !== "local-test-feed") {
    if (/\b404\b/i.test(trimmedMessage)) {
      return localized(
        "The update feed could not be found. Check the update source configuration and try again.",
        "未找到更新源。请检查更新源配置后重试。",
      );
    }

    if (/\b(5\d\d|502|503|504)\b/i.test(trimmedMessage)) {
      return localized(
        "The update server is temporarily unavailable. Try again in a moment.",
        "更新服务器暂时不可用。请稍后重试。",
      );
    }

    return trimmedMessage;
  }

  if (
    /404\s+Not\s+Found/i.test(trimmedMessage) ||
    /\b404\b/i.test(trimmedMessage)
  ) {
    return localized(
      "The test update feed is unavailable. Check the guide and verify your NEXU_UPDATE_FEED_URL configuration.",
      "测试更新源不可用。请查看说明文档，并检查 NEXU_UPDATE_FEED_URL 配置是否正确。",
    );
  }

  if (/\b(5\d\d|502|503|504)\b/i.test(trimmedMessage)) {
    return localized(
      "The test update server is temporarily unavailable. Try again later or verify your feed configuration.",
      "测试更新服务器暂时不可用。请稍后重试，或检查更新源配置。",
    );
  }

  return trimmedMessage;
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
  const [pendingCheck, setPendingCheck] = useState(false);
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
          dismissed: false,
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
          dismissed: false,
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
          dismissed: false,
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
          dismissed: false,
          userInitiated: false,
        }));
      }),
    );

    disposers.push(
      updater.onEvent("update:error", (data) => {
        const rawMessage = data.rawMessage ?? data.message;
        const friendlyMessage = normalizeUpdateErrorMessage(
          data.message,
          experience,
        );
        console.error("[desktop] update failed", {
          rawMessage,
          friendlyMessage,
          diagnostic: data.diagnostic ?? null,
        });
        setState((prev) => ({
          ...prev,
          phase: "error",
          errorMessage: friendlyMessage,
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

  useEffect(() => {
    if (!pendingCheck || state.capability === null) {
      return;
    }

    if (!state.capability.check) {
      setPendingCheck(false);
      setState((prev) => ({
        ...prev,
        phase: "idle",
        userInitiated: false,
      }));
      return;
    }

    setPendingCheck(false);
    void checkForUpdate().catch(() => {
      // Errors are delivered via the update:error event
    });
  }, [pendingCheck, state.capability]);

  const check = useCallback(async () => {
    if (state.capability === null) {
      setPendingCheck(true);
      setState((prev) => ({
        ...prev,
        phase: "checking",
        errorMessage: null,
        dismissed: false,
        userInitiated: true,
      }));
      return;
    }

    if (!state.capability.check) {
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

  return { ...state, check, download, install, dismiss, undismiss };
}
