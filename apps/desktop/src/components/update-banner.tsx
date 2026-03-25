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
  onRetry: () => void;
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
    phase === "available" || phase === "downloading" || phase === "ready";
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
  if (phase === "idle" || dismissed) {
    return null;
  }

  const isChecking = phase === "checking";
  const isUpToDate = phase === "up-to-date";
  const isDownloading = phase === "downloading";
  const isReady = phase === "ready";
  const isError = phase === "error";
  const isAvailable = phase === "available";

  return (
    <div className={`update-card${isError ? " update-card--error" : ""}`}>
      {/* Header row: status dot + title | close button */}
      <div className="update-card-header">
        <div className="update-card-status">
          <span
            className={`update-dot-wrapper${isError ? " update-dot--error" : ""}`}
          >
            <span className="update-dot-ping" />
            <span className="update-dot" />
          </span>
          <span className="update-card-title">
            {isChecking && "Checking\u2026"}
            {isUpToDate && "Up to date"}
            {isDownloading && "Downloading\u2026"}
            {isAvailable && `v${version} available`}
            {isReady && `v${version} ready`}
            {isError && "Update failed"}
          </span>
        </div>
        {!isDownloading && !isChecking && (
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

      {(isChecking || isUpToDate) && (
        <div className="update-card-message">
          {isChecking
            ? "Contacting the update feed and comparing the latest release..."
            : "This channel is already on the latest available version."}
        </div>
      )}

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
        <div className="update-card-actions">
          <button
            className="update-card-btn update-card-btn--primary"
            onClick={onRetry}
            type="button"
          >
            Retry
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
    </div>
  );
}
