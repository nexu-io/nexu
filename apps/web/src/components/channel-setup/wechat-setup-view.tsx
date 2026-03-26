import { identify, track } from "@/lib/tracking";
import { Loader2, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  postApiV1ChannelsWechatConnect,
  postApiV1ChannelsWechatQrStart,
  postApiV1ChannelsWechatQrWait,
} from "../../../lib/api/sdk.gen";

type Phase =
  | "idle"
  | "waiting-gateway"
  | "loading-qr"
  | "scanning"
  | "connecting"
  | "error";

const RETRY_DELAY_MS = 2000;

// Fake progress: gateway usually ready in 15-30s.
// We simulate 0→95% over ~40s with easing (fast→slow), then hold at 95%.
const PROGRESS_INTERVAL_MS = 400;
const PROGRESS_DURATION_MS = 40_000;

function isQrImageSource(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("data:image/");
}

function calcFakeProgress(elapsedMs: number): number {
  const ratio = Math.min(elapsedMs / PROGRESS_DURATION_MS, 1);
  // Ease-out: fast start, slow finish, caps at 95%
  return Math.round(95 * (1 - (1 - ratio) ** 2.5));
}

export interface WechatSetupViewProps {
  onConnected: () => void;
  disabled?: boolean;
  /** When true, gateway is known to be running — skip "waiting gateway" hint. */
  gatewayReady?: boolean;
  showHeader?: boolean;
}

export function WechatSetupView({
  onConnected,
  disabled,
  gatewayReady,
  showHeader = true,
}: WechatSetupViewProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const progressStartRef = useRef(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startProgress = useCallback(() => {
    progressStartRef.current = Date.now();
    setProgress(0);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - progressStartRef.current;
      setProgress(calcFakeProgress(elapsed));
    }, PROGRESS_INTERVAL_MS);
  }, []);

  const stopProgress = useCallback(() => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }, []);

  const startQrFlow = useCallback(async () => {
    cleanup();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase(gatewayReady ? "loading-qr" : "waiting-gateway");
    setQrUrl(null);
    setErrorMessage(null);
    startProgress();

    try {
      let startData: {
        qrDataUrl?: string;
        message: string;
        sessionKey?: string;
      } | null = null;

      // Keep retrying until QR is obtained. Gateway/timeout errors are
      // transient (gateway still booting or plugin not loaded yet).
      // Only bail on genuinely unexpected errors or abort (panel closed).
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (controller.signal.aborted) return;
        const { data, error } = await postApiV1ChannelsWechatQrStart();
        if (controller.signal.aborted) return;
        if (data?.qrDataUrl) {
          startData = data;
          break;
        }
        const errorMsg =
          error && typeof error === "object" && "message" in error
            ? String(error.message)
            : "";
        const isRetryable =
          errorMsg.toLowerCase().includes("gateway not connected") ||
          errorMsg.toLowerCase().includes("timed out") ||
          errorMsg === "";
        if (!isRetryable) {
          stopProgress();
          setErrorMessage(
            errorMsg || data?.message || t("wechatSetup.connectFailed"),
          );
          setPhase("error");
          return;
        }
        setPhase("waiting-gateway");
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }

      stopProgress();
      if (!startData.sessionKey) {
        setErrorMessage(t("wechatSetup.connectFailed"));
        setPhase("error");
        return;
      }
      setQrUrl(startData.qrDataUrl ?? null);
      setPhase("scanning");

      const { data: waitData, error: waitError } =
        await postApiV1ChannelsWechatQrWait({
          body: { sessionKey: startData.sessionKey },
        });

      if (controller.signal.aborted) return;

      if (waitError || !waitData) {
        const msg =
          typeof waitError === "object" &&
          waitError !== null &&
          "message" in waitError
            ? String(waitError.message)
            : t("wechatSetup.timeout");
        setErrorMessage(msg);
        setPhase("error");
        return;
      }

      if (waitData.connected && waitData.accountId) {
        setPhase("connecting");
        const { error: connectError } = await postApiV1ChannelsWechatConnect({
          body: { accountId: waitData.accountId },
        });

        if (connectError) {
          const msg =
            typeof connectError === "object" &&
            connectError !== null &&
            "message" in connectError
              ? String(connectError.message)
              : t("wechatSetup.connectFailed");
          setErrorMessage(msg);
          setPhase("error");
          return;
        }

        toast.success(t("wechatSetup.connectSuccess"));
        track("channel_ready", {
          channel: "wechat",
          channel_type: "wechat_personal",
        });
        identify({ channels_connected: 1 });
        onConnected();
        setPhase("idle");
      } else {
        setErrorMessage(waitData.message || t("wechatSetup.timeout"));
        setPhase("error");
      }
    } catch {
      if (!abortRef.current?.signal.aborted) {
        stopProgress();
        setErrorMessage(t("wechatSetup.connectFailed"));
        setPhase("error");
      }
    }
  }, [cleanup, gatewayReady, onConnected, startProgress, stopProgress, t]);

  const isLoading =
    phase === "waiting-gateway" ||
    phase === "loading-qr" ||
    phase === "scanning" ||
    phase === "connecting";

  return (
    <div
      className={
        showHeader ? "p-5 rounded-xl border bg-surface-1 border-border" : ""
      }
    >
      {showHeader && (
        <div className="flex gap-3 items-start mb-5">
          <div className="flex justify-center items-center w-9 h-9 rounded-lg bg-[var(--color-success-muted)] shrink-0">
            <Smartphone size={18} className="text-[var(--color-success)]" />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-text-primary">
              {t("wechatSetup.title")}
            </h3>
            <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
              {t("wechatSetup.desc")}
            </p>
          </div>
        </div>
      )}

      <div
        className={
          showHeader
            ? "flex flex-col items-center gap-4 py-4"
            : "flex flex-col items-center gap-3 py-1"
        }
      >
        {/* QR code display area */}
        {qrUrl && phase === "scanning" ? (
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 bg-white rounded-xl shadow-sm border border-border">
              {isQrImageSource(qrUrl) ? (
                <img
                  src={qrUrl}
                  alt={t("wechatSetup.title")}
                  className="block w-[208px] h-[208px] object-contain"
                />
              ) : (
                <QRCodeSVG value={qrUrl} size={208} />
              )}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--color-success)]" />
              {t("wechatSetup.scanning")}
            </div>
            <p className="text-[11px] text-text-muted text-center max-w-xs leading-relaxed">
              {t("wechatSetup.scanHint")}
            </p>
          </div>
        ) : phase === "waiting-gateway" ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--color-success)]" />
            <span className="text-[12px] text-text-muted">
              {t("wechatSetup.waitingGateway")} {progress}%
            </span>
          </div>
        ) : phase === "loading-qr" ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--color-success)]" />
            <span className="text-[12px] text-text-muted">
              {t("wechatSetup.loadingQr")} {progress}%
            </span>
          </div>
        ) : phase === "connecting" ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--color-success)]" />
            <span className="text-[12px] text-text-muted">
              {t("wechatSetup.connectSuccess")}
            </span>
          </div>
        ) : phase === "error" ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/15">
              <QrCode size={48} className="text-red-400" />
            </div>
            <p className="text-[12px] text-red-500 text-center max-w-xs">
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={startQrFlow}
              className="flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-accent-fg rounded-lg bg-accent hover:bg-accent-hover transition-all cursor-pointer"
            >
              <RefreshCw size={13} />
              {t("wechatSetup.retry")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-1">
            <div className="p-3 rounded-xl bg-[var(--color-success-subtle)] border border-[var(--color-success-border)]">
              <QrCode size={48} className="text-[var(--color-success)]" />
            </div>
            <button
              type="button"
              onClick={startQrFlow}
              disabled={disabled || isLoading}
              className="flex gap-1.5 items-center px-5 py-2.5 text-[13px] font-medium text-accent-fg rounded-lg bg-accent hover:bg-accent-hover transition-all disabled:opacity-60 cursor-pointer"
            >
              <QrCode size={14} />
              {t("wechatSetup.scanQr")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
