import { NEXU_GITHUB_RELEASES_URL } from "../../shared/product-urls";
import type { UpdatePhase } from "../hooks/use-auto-update";
import { openExternal } from "../lib/host-api";

interface UpdateBannerProps {
  phase: UpdatePhase;
  version: string | null;
  errorMessage: string | null;
  dismissed: boolean;
  onInstall: () => void;
  onDismiss: () => void;
  onRetry: () => void;
}

/**
 * Small pill badge shown in the brand area when the update card is dismissed.
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
  if (phase !== "ready" || !dismissed) return null;

  return (
    <button className="update-badge" onClick={onUndismiss} type="button">
      Update
    </button>
  );
}

/**
 * Sidebar update card — only shown when update is downloaded and ready,
 * or when an error occurred. No download progress state.
 */
export function UpdateBanner({
  phase,
  version,
  errorMessage,
  dismissed,
  onInstall,
  onDismiss,
  onRetry,
}: UpdateBannerProps) {
  const isReady = phase === "ready";
  const isError = phase === "error";

  if ((!isReady && !isError) || dismissed) {
    return null;
  }

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
            {isReady && `v${version} ready`}
            {isError && "Update failed"}
          </span>
        </div>
        <button className="update-card-close" onClick={onDismiss} type="button">
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
      </div>

      {isReady && (
        <div className="update-card-actions">
          <button
            className="update-card-btn update-card-btn--primary"
            onClick={onInstall}
            type="button"
          >
            Install
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
