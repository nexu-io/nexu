import { useState } from "react";
import { NEXU_GITHUB_RELEASES_URL } from "../../shared/product-urls";
import type { UpdatePhase } from "../hooks/use-auto-update";
import { openExternal } from "../lib/host-api";

interface UpdateBannerProps {
  phase: UpdatePhase;
  version: string | null;
  percent: number;
  errorMessage: string | null;
  dismissed: boolean;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  onRetry: () => void | Promise<void>;
}

function NexuLogo() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 800 800"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="nexu"
    >
      <path
        fill="#042028"
        d="M193.435 0C300.266 0 386.869 86.6036 386.869 193.435V345.42C386.869 368.312 368.311 386.87 345.419 386.87H41.4502C18.5579 386.87 0 368.311 0 345.419V193.435C0 86.6036 86.6036 0 193.435 0ZM180.539 206.328V386.867H206.331V206.328H180.539Z"
      />
      <path
        fill="#042028"
        d="M606.095 799.53C499.264 799.53 412.66 712.926 412.66 606.095L412.66 454.11C412.661 431.217 431.218 412.659 454.111 412.659L758.079 412.659C780.972 412.659 799.53 431.218 799.53 454.111L799.53 606.095C799.53 712.926 712.926 799.53 606.095 799.53ZM618.99 593.2L618.991 412.661L593.199 412.661L593.199 593.2L618.99 593.2Z"
      />
      <path
        fill="#042028"
        d="M799.531 193.447C799.531 193.551 799.53 193.655 799.53 193.759L799.53 193.134C799.53 193.238 799.531 193.343 799.531 193.447ZM412.661 193.447C412.661 86.6158 499.265 0.0122032 606.096 0.0121986C708.589 0.0121941 792.462 79.725 799.105 180.537L618.99 180.537L618.99 206.329L799.107 206.329C792.477 307.154 708.598 386.881 606.096 386.881C499.265 386.881 412.661 300.278 412.661 193.447Z"
      />
      <path
        fill="#042028"
        d="M-8.45487e-06 606.105C-1.0587e-05 557.327 18.0554 512.768 47.8447 478.741L148.407 579.303L166.645 561.066L66.082 460.504C100.109 430.715 144.667 412.66 193.444 412.66C240.179 412.66 283.043 429.237 316.478 456.83L212.225 561.084L230.462 579.322L335.244 474.538C367.28 509.055 386.869 555.285 386.869 606.09C386.869 654.866 368.812 699.424 339.022 733.45L227.657 622.084L209.42 640.322L320.784 751.688C286.758 781.475 242.203 799.53 193.43 799.53C142.628 799.53 96.4006 779.944 61.8848 747.913L169.45 640.348L151.213 622.111L44.1758 729.148C16.5783 695.712 1.56674e-05 652.844 -8.45487e-06 606.105Z"
      />
    </svg>
  );
}

/**
 * Centered modal dialog shown when user manually checks for updates.
 * Covers "checking" and "up-to-date" phases only.
 */
export function UpdateCheckDialog({
  phase,
  version,
  onClose,
}: {
  phase: UpdatePhase;
  version: string | null;
  onClose: () => void;
}) {
  const isChecking = phase === "checking";
  const isUpToDate = phase === "up-to-date";

  if (!isChecking && !isUpToDate) {
    return null;
  }

  const handleOverlayClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isUpToDate) return;
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleOverlayKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isUpToDate) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="update-dialog-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleOverlayKeyDown}
      role={isUpToDate ? "button" : "presentation"}
      tabIndex={isUpToDate ? 0 : -1}
    >
      <div className="update-dialog">
        <div className="update-dialog-logo">
          <NexuLogo />
        </div>

        <h2 className="update-dialog-title">
          {isChecking
            ? "Checking for updates\u2026"
            : "You\u2019re up to date!"}
        </h2>

        {isUpToDate && version && (
          <p className="update-dialog-subtitle">
            nexu {version} is the latest version.
          </p>
        )}

        {isChecking && (
          <div className="update-dialog-progress">
            <div className="update-dialog-progress-track">
              <div className="update-dialog-progress-fill" />
            </div>
          </div>
        )}

        {isUpToDate && (
          <button className="update-dialog-btn" onClick={onClose} type="button">
            OK
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Small pill badge shown in the brand area when the update banner is dismissed.
 * Clicking it re-opens the full banner.
 */
export function UpdateBadge({
  phase,
  dismissed,
  onUndismiss,
}: {
  phase: UpdatePhase;
  dismissed: boolean;
  onUndismiss: () => void;
}) {
  const hasUpdate =
    phase === "available" ||
    phase === "downloading" ||
    phase === "ready" ||
    phase === "error";
  if (!hasUpdate || !dismissed) return null;

  return (
    <button className="update-badge" onClick={onUndismiss} type="button">
      Update
    </button>
  );
}

/**
 * Sidebar-embedded update card — 1:1 replica of the design-system prototype.
 * Light frosted-glass card that floats inside the dark sidebar.
 */
export function UpdateBanner({
  phase,
  version,
  percent,
  errorMessage,
  dismissed,
  onDownload,
  onInstall,
  onDismiss,
  onRetry,
}: UpdateBannerProps) {
  const [retrying, setRetrying] = useState(false);
  const showCard =
    phase === "available" ||
    phase === "downloading" ||
    phase === "ready" ||
    phase === "error";

  if (!showCard || dismissed) {
    return null;
  }

  const isDownloading = phase === "downloading";
  const isReady = phase === "ready";
  const isError = phase === "error";
  const isAvailable = phase === "available";

  const handleRetry = () => {
    if (retrying) return;

    setRetrying(true);
    void Promise.resolve(onRetry()).finally(() => {
      setRetrying(false);
    });
  };

  return (
    <div className={`update-card${isError ? " update-card--error" : ""}`}>
      <div className="update-card-header">
        <div className="update-card-status">
          <span
            className={`update-dot-wrapper${isError ? " update-dot--error" : ""}`}
          >
            <span className="update-dot-ping" />
            <span className="update-dot" />
          </span>
          <span className="update-card-title">
            {isDownloading && "Downloading\u2026"}
            {isAvailable && `v${version} available`}
            {isReady && `v${version} ready`}
            {isError && "Update failed"}
          </span>
        </div>
        {!isDownloading && (
          <button
            className="update-card-close"
            onClick={onDismiss}
            type="button"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              role="img"
              aria-label="Close"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Downloading — progress bar, then percentage right-aligned below */}
      {isDownloading && (
        <div className="update-card-progress-wrap">
          <div className="update-card-progress-track">
            <div
              className="update-card-progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="update-card-percent">
            <span>{Math.round(percent)}%</span>
          </div>
        </div>
      )}

      {/* Available — Download + Changelog */}
      {isAvailable && (
        <div className="update-card-actions">
          <button
            className="update-card-btn update-card-btn--primary"
            onClick={onDownload}
            type="button"
          >
            Download
          </button>
          <button
            type="button"
            className="update-card-changelog"
            onClick={() => void openExternal(NEXU_GITHUB_RELEASES_URL)}
          >
            Changelog
          </button>
        </div>
      )}

      {/* Ready — Restart + Changelog */}
      {isReady && (
        <div className="update-card-actions">
          <button
            className="update-card-btn update-card-btn--primary"
            onClick={onInstall}
            type="button"
          >
            Restart
          </button>
          <button
            type="button"
            className="update-card-changelog"
            onClick={() => void openExternal(NEXU_GITHUB_RELEASES_URL)}
          >
            Changelog
          </button>
        </div>
      )}

      {/* Error — Retry + Changelog */}
      {isError && (
        <>
          {errorMessage && (
            <div className="update-card-error-msg">{errorMessage}</div>
          )}
          <div className="update-card-actions">
            <button
              className="update-card-btn update-card-btn--primary"
              disabled={retrying}
              onClick={handleRetry}
              type="button"
            >
              {retrying ? "Checking…" : "Retry"}
            </button>
            <button
              type="button"
              className="update-card-changelog"
              onClick={() => void openExternal(NEXU_GITHUB_RELEASES_URL)}
            >
              Changelog
            </button>
          </div>
        </>
      )}
    </div>
  );
}
