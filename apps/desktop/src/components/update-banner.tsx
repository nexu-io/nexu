import type { UpdatePhase } from "../hooks/use-auto-update";

interface UpdateBannerProps {
  phase: UpdatePhase;
  version: string | null;
  percent: number;
  errorMessage: string | null;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({
  phase,
  version,
  percent,
  errorMessage,
  onDownload,
  onInstall,
  onDismiss,
}: UpdateBannerProps) {
  if (phase === "idle" || phase === "checking") {
    return null;
  }

  return (
    <div className={`update-banner update-banner--${phase}`}>
      <div className="update-banner-content">
        {phase === "available" && (
          <>
            <span>
              New version <strong>{version}</strong> is available.
            </span>
            <div className="update-banner-actions">
              <button
                className="update-banner-btn update-banner-btn--primary"
                onClick={onDownload}
                type="button"
              >
                Download
              </button>
              <button
                className="update-banner-btn"
                onClick={onDismiss}
                type="button"
              >
                Later
              </button>
            </div>
          </>
        )}

        {phase === "downloading" && (
          <>
            <span>Downloading update… {Math.round(percent)}%</span>
            <div className="update-banner-progress">
              <div
                className="update-banner-progress-bar"
                style={{ width: `${percent}%` }}
              />
            </div>
          </>
        )}

        {phase === "ready" && (
          <>
            <span>
              Version <strong>{version}</strong> is ready to install.
            </span>
            <div className="update-banner-actions">
              <button
                className="update-banner-btn update-banner-btn--primary"
                onClick={onInstall}
                type="button"
              >
                Restart &amp; Update
              </button>
              <button
                className="update-banner-btn"
                onClick={onDismiss}
                type="button"
              >
                Later
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <span>Update failed: {errorMessage ?? "Unknown error"}</span>
            <div className="update-banner-actions">
              <button
                className="update-banner-btn"
                onClick={onDismiss}
                type="button"
              >
                Dismiss
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
