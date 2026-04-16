import { identify, track } from "@/lib/tracking";
import { Loader2, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  postApiV1ChannelsWhatsappConnect,
  postApiV1ChannelsWhatsappQrStart,
  postApiV1ChannelsWhatsappQrWait,
} from "../../../lib/api/sdk.gen";

type Phase = "idle" | "loading-qr" | "scanning" | "connecting" | "error";

function isQrImageSource(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("data:image/");
}

export interface WhatsappSetupViewProps {
  onConnected: () => void;
  disabled?: boolean;
}

export function WhatsappSetupView({
  onConnected,
  disabled,
}: WhatsappSetupViewProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const finalizeConnect = useCallback(
    async (accountId: string) => {
      if (!mountedRef.current) {
        return;
      }
      setPhase("connecting");
      const { error } = await postApiV1ChannelsWhatsappConnect({
        body: { accountId },
      });
      if (!mountedRef.current) {
        return;
      }
      if (error) {
        const message =
          typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : t("whatsappSetup.connectFailed");
        setErrorMessage(message);
        setPhase("error");
        return;
      }

      toast.success(t("whatsappSetup.connectSuccess"));
      track("channel_ready", {
        channel: "whatsapp",
        channel_type: "whatsapp_personal",
      });
      identify({ channels_connected: 1 });
      onConnected();
      if (mountedRef.current) {
        setPhase("idle");
        setQrUrl(null);
      }
    },
    [onConnected, t],
  );

  const startQrFlow = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }
    setPhase("loading-qr");
    setQrUrl(null);
    setErrorMessage(null);

    const { data, error } = await postApiV1ChannelsWhatsappQrStart();
    if (!mountedRef.current) {
      return;
    }
    if (error || !data) {
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String(error.message)
          : t("whatsappSetup.startFailed");
      setErrorMessage(message);
      setPhase("error");
      return;
    }

    if (data.alreadyLinked) {
      await finalizeConnect(data.accountId);
      return;
    }

    if (!data.qrDataUrl) {
      setErrorMessage(data.message || t("whatsappSetup.loadQrFailed"));
      setPhase("error");
      return;
    }

    setQrUrl(data.qrDataUrl);
    setPhase("scanning");

    while (mountedRef.current) {
      const { data: waitData, error: waitError } =
        await postApiV1ChannelsWhatsappQrWait({
          body: { accountId: data.accountId },
        });

      if (!mountedRef.current) {
        return;
      }

      if (waitError || !waitData) {
        const message =
          typeof waitError === "object" &&
          waitError !== null &&
          "message" in waitError
            ? String(waitError.message)
            : t("whatsappSetup.waitFailed");
        setErrorMessage(message);
        setPhase("error");
        return;
      }

      if (waitData.connected) {
        await finalizeConnect(data.accountId);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }, [finalizeConnect, t]);

  const isLoading =
    phase === "loading-qr" || phase === "scanning" || phase === "connecting";

  return (
    <div className="p-5 rounded-xl border bg-surface-1 border-border">
      <div className="flex gap-3 items-start mb-5">
        <div className="flex justify-center items-center w-9 h-9 rounded-lg bg-emerald-500/10 shrink-0">
          <Smartphone size={18} className="text-emerald-500" />
        </div>
        <div>
          <h3 className="text-[14px] font-semibold text-text-primary">
            {t("whatsappSetup.personalTitle")}
          </h3>
          <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
            {t("whatsappSetup.desc")}
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 py-2">
        {qrUrl && phase === "scanning" ? (
          <div className="flex flex-col items-center gap-3">
            <div className="p-3 bg-white rounded-xl shadow-sm border border-border">
              {isQrImageSource(qrUrl) ? (
                <img
                  src={qrUrl}
                  alt={t("whatsappSetup.qrAlt")}
                  className="block w-[208px] h-[208px] object-contain"
                />
              ) : (
                <QRCodeSVG value={qrUrl} size={208} />
              )}
            </div>
            <div className="flex items-center gap-2 text-[12px] text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
              {t("whatsappSetup.waitingForScan")}
            </div>
            <p className="text-[11px] text-text-muted text-center max-w-xs leading-relaxed">
              {t("whatsappSetup.scanHint")}
            </p>
          </div>
        ) : phase === "loading-qr" ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            <span className="text-[12px] text-text-muted">
              {t("whatsappSetup.preparingQr")}
            </span>
          </div>
        ) : phase === "connecting" ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            <span className="text-[12px] text-text-muted">
              {t("whatsappSetup.finishingConnection")}
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
              className="flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-accent-fg rounded-lg bg-accent hover:bg-accent-hover transition-all"
            >
              <RefreshCw size={13} />
              {t("whatsappSetup.retry")}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-1">
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <QrCode size={48} className="text-emerald-500" />
            </div>
            <button
              type="button"
              onClick={startQrFlow}
              disabled={disabled || isLoading}
              className="flex gap-1.5 items-center px-5 py-2.5 text-[13px] font-medium text-accent-fg rounded-lg bg-accent hover:bg-accent-hover transition-all disabled:opacity-60"
            >
              <QrCode size={14} />
              {t("whatsappSetup.scanQr")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
