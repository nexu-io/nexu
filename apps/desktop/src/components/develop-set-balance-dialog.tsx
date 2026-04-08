import { useEffect, useId, useState } from "react";
import {
  getDesktopRewardsStatus,
  notifyDesktopRewardsUpdated,
  setDesktopRewardBalance,
} from "../lib/host-api";

type DesktopRewardsStatus = {
  cloudBalance?: {
    totalBalance?: number | null;
  } | null;
};

type DevelopSetBalanceDialogProps = {
  open: boolean;
  onClose: () => void;
};

export async function fetchCurrentBalance(): Promise<number> {
  const payload = (await getDesktopRewardsStatus()) as DesktopRewardsStatus;
  return payload.cloudBalance?.totalBalance ?? 0;
}

export async function setCurrentBalance(balance: number): Promise<number> {
  const payload = (await setDesktopRewardBalance(
    balance,
  )) as DesktopRewardsStatus;
  return payload.cloudBalance?.totalBalance ?? balance;
}

export function DevelopSetBalanceDialog({
  open,
  onClose,
}: DevelopSetBalanceDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const [balance, setBalance] = useState("0");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let isActive = true;
    setLoading(true);
    setErrorMessage(null);

    void fetchCurrentBalance()
      .then((currentBalance) => {
        if (!isActive) {
          return;
        }

        setBalance(String(currentBalance));
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setBalance("0");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load the current test balance.",
        );
      })
      .finally(() => {
        if (isActive) {
          setLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const handleConfirm = async () => {
    const parsedBalance = Number(balance.trim());
    if (!Number.isInteger(parsedBalance) || parsedBalance < 0) {
      setErrorMessage("Enter a non-negative whole number.");
      return;
    }

    setSaving(true);
    setErrorMessage(null);

    try {
      const nextBalance = await setCurrentBalance(parsedBalance);
      setBalance(String(nextBalance));
      await notifyDesktopRewardsUpdated().catch(() => undefined);
      onClose();
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to update the test balance.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismisses the modal */}
      <div
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(6px)",
        }}
      />
      <dialog
        open
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 420,
          border: "1px solid rgba(255, 255, 255, 0.14)",
          borderRadius: 16,
          background: "#0f1115",
          color: "#f4f7fb",
          boxShadow: "0 24px 72px rgba(0, 0, 0, 0.35)",
          padding: 0,
        }}
      >
        <div
          style={{
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            padding: "18px 20px 14px",
          }}
        >
          <div id={titleId} style={{ fontSize: 14, fontWeight: 600 }}>
            Set test balance
          </div>
          <p
            id={descriptionId}
            style={{
              margin: "6px 0 0",
              fontSize: 12,
              color: "rgba(244, 247, 251, 0.72)",
            }}
          >
            Update the current desktop test balance.
          </p>
        </div>

        <div style={{ padding: 20 }}>
          <label htmlFor={inputId} style={{ display: "block" }}>
            <span
              style={{
                display: "block",
                marginBottom: 8,
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              Balance
            </span>
            <input
              id={inputId}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={balance}
              disabled={loading || saving}
              onChange={(event) => setBalance(event.target.value)}
              style={{
                width: "100%",
                height: 40,
                borderRadius: 10,
                border: "1px solid rgba(255, 255, 255, 0.12)",
                background: "rgba(255, 255, 255, 0.04)",
                color: "inherit",
                padding: "0 12px",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </label>

          {errorMessage ? (
            <div style={{ marginTop: 10, fontSize: 12, color: "#ff8b8b" }}>
              {errorMessage}
            </div>
          ) : loading ? (
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "rgba(244, 247, 251, 0.64)",
              }}
            >
              Loading current balance…
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 16,
            }}
          >
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={loading || saving}
              style={{
                border: 0,
                borderRadius: 10,
                padding: "10px 16px",
                background: "#4f46e5",
                color: "white",
                fontSize: 12,
                fontWeight: 600,
                cursor: loading || saving ? "not-allowed" : "pointer",
                opacity: loading || saving ? 0.7 : 1,
              }}
            >
              {saving ? "Saving…" : "Confirm"}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
