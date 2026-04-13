import type { DesktopUpdateCapability } from "../../shared/host";
import type { DesktopUpdateExperience } from "../../shared/update-policy";
import type { UpdatePhase } from "../hooks/use-auto-update";
import { resolveLocale } from "../lib/i18n";

interface UpdateBannerProps {
  capability: DesktopUpdateCapability | null;
  experience: DesktopUpdateExperience;
  phase: UpdatePhase;
  currentVersion: string | null;
  version: string | null;
  releaseNotes: string | null;
  percent: number;
  errorMessage: string | null;
  dismissed: boolean;
  canCheckForUpdates: boolean;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}

const i18n = {
  en: {
    badge: "Update",
    checking: "Checking for updates...",
    upToDate: "You're up to date",
    downloading: "Downloading update…",
    installing: "Preparing to install and restart…",
    available: (version: string) => `v${version} available`,
    ready: (version: string) => `v${version} ready`,
    error: "Update failed",
    checkingDetail: "This usually only takes a few seconds.",
    upToDateDetail: "This channel is already on the latest available version.",
    download: "Download",
    restart: "Restart",
    manual: "Open installer",
    later: "Later",
    dismiss: "Dismiss",
    currentVersion: "Current version",
    latestVersion: "Latest version",
    releaseNotes: "Release notes",
    unknownError: "Unknown error",
    closeLabel: "Close",
    localValidation: "Local validation build",
    localValidationDetail:
      "This build does not use the production update feed by default. To validate the real update flow, adjust the environment variables according to the repository documentation before testing.",
    localTestFeed: "Update test mode",
    localTestFeedDetail:
      "This local validation build has a test update feed configured. Before testing, adjust the environment variables according to the repository documentation.",
    checkNow: "Check for updates",
    retry: "Retry",
  },
  zh: {
    badge: "更新",
    checking: "正在检查更新...",
    upToDate: "已是最新版本",
    downloading: "正在下载更新…",
    installing: "正在准备安装并重启…",
    available: (version: string) => `v${version} 可更新`,
    ready: (version: string) => `v${version} 已就绪`,
    error: "更新失败",
    checkingDetail: "通常只需要几秒。",
    upToDateDetail: "当前频道已是最新可用版本。",
    download: "下载",
    restart: "重启安装",
    manual: "打开安装包",
    later: "稍后",
    dismiss: "关闭",
    currentVersion: "当前版本",
    latestVersion: "最新版本",
    releaseNotes: "更新日志",
    unknownError: "未知错误",
    closeLabel: "关闭",
    localValidation: "本地验收构建",
    localValidationDetail:
      "当前版本为本地验收构建，未默认连接正式更新源。请按照仓库内的文档说明调整环境变量后测试。",
    localTestFeed: "更新测试模式",
    localTestFeedDetail:
      "当前版本为本地验收构建，已配置测试更新源。请按照仓库内的文档说明调整环境变量后测试。",
    checkNow: "检查更新",
    retry: "重试",
  },
};

export function UpdateBadge({
  phase,
  dismissed,
  onUndismiss,
}: {
  phase: UpdatePhase;
  dismissed: boolean;
  onUndismiss: () => void;
}) {
  const t = resolveLocale(i18n);
  const hasUpdate =
    phase === "available" ||
    phase === "downloading" ||
    phase === "installing" ||
    phase === "ready";
  if (!hasUpdate || !dismissed) return null;

  return (
    <button className="update-badge" onClick={onUndismiss} type="button">
      {t.badge}
    </button>
  );
}

export function UpdateBanner({
  capability,
  experience,
  phase,
  currentVersion,
  version,
  releaseNotes,
  percent,
  errorMessage,
  dismissed,
  canCheckForUpdates,
  onCheck,
  onDownload,
  onInstall,
  onDismiss,
}: UpdateBannerProps) {
  const isLocalValidation =
    phase === "idle" && experience === "local-validation";
  const isLocalTestFeed = phase === "idle" && experience === "local-test-feed";

  if (phase === "idle" && !isLocalValidation && !isLocalTestFeed) {
    return null;
  }

  if (dismissed) {
    return null;
  }

  const t = resolveLocale(i18n);
  const isChecking = phase === "checking";
  const isUpToDate = phase === "up-to-date";
  const isDownloading = phase === "downloading";
  const isInstalling = phase === "installing";
  const isReady = phase === "ready";
  const isError = phase === "error";
  const isAvailable = phase === "available";
  const isLocalInfo = isLocalValidation || isLocalTestFeed;
  const showsVersionDetails = (isAvailable || isReady) && Boolean(version);
  const showsReleaseNotes = isAvailable && Boolean(releaseNotes);
  const downloadLabel =
    capability?.downloadMode === "external" ? t.manual : t.download;
  const applyLabel =
    capability?.applyLabel ??
    (capability?.applyMode === "redirect" ||
    capability?.applyMode === "external-installer"
      ? t.manual
      : t.restart);

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
            {isChecking && t.checking}
            {isUpToDate && t.upToDate}
            {isDownloading && t.downloading}
            {isInstalling && t.installing}
            {isAvailable && version && t.available(version)}
            {isReady && version && t.ready(version)}
            {isError && t.error}
            {isLocalValidation && t.localValidation}
            {isLocalTestFeed && t.localTestFeed}
          </span>
        </div>
        {!isDownloading && !isInstalling && !isChecking && (
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
              aria-label={t.closeLabel}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {(isChecking || isUpToDate || isInstalling) && (
        <div className="update-card-message">
          {isChecking
            ? t.checkingDetail
            : isInstalling
              ? t.installing
              : t.upToDateDetail}
        </div>
      )}

      {isLocalInfo && (
        <div className="update-card-message">
          {isLocalValidation ? t.localValidationDetail : t.localTestFeedDetail}
        </div>
      )}

      {showsVersionDetails && version && (
        <div className="update-card-message">
          <div>
            {t.currentVersion}: {currentVersion ? `v${currentVersion}` : "—"}
          </div>
          <div>
            {t.latestVersion}: v{version}
          </div>
        </div>
      )}

      {showsReleaseNotes && releaseNotes && (
        <div className="update-card-message" style={{ whiteSpace: "pre-wrap" }}>
          <strong>{t.releaseNotes}</strong>
          <div>{releaseNotes}</div>
        </div>
      )}

      {(isDownloading || isInstalling) && (
        <>
          <div className="update-card-percent">
            <span>{isInstalling ? "…" : `${Math.round(percent)}%`}</span>
          </div>
          <div className="update-card-progress-wrap">
            <div className="update-card-progress-track">
              <div
                className="update-card-progress-fill"
                style={{ width: isInstalling ? "100%" : `${percent}%` }}
              />
            </div>
          </div>
        </>
      )}

      {isAvailable && (
        <div className="update-card-actions">
          <button
            className="update-card-btn update-card-btn--primary"
            onClick={onDownload}
            type="button"
          >
            {downloadLabel}
          </button>
          <button
            className="update-card-btn update-card-btn--ghost"
            onClick={onDismiss}
            type="button"
          >
            {t.later}
          </button>
        </div>
      )}

      {isReady && (
        <div className="update-card-actions">
          <button
            className="update-card-btn update-card-btn--primary"
            onClick={onInstall}
            type="button"
          >
            {applyLabel}
          </button>
          <button
            className="update-card-btn update-card-btn--ghost"
            onClick={onDismiss}
            type="button"
          >
            {t.later}
          </button>
        </div>
      )}

      {isLocalValidation && (
        <div className="update-card-actions">
          <button
            className="update-card-btn update-card-btn--ghost"
            onClick={onDismiss}
            type="button"
          >
            {t.dismiss}
          </button>
        </div>
      )}

      {isLocalTestFeed && (
        <div className="update-card-actions">
          {canCheckForUpdates && (
            <button
              className="update-card-btn update-card-btn--primary"
              onClick={onCheck}
              type="button"
            >
              {t.checkNow}
            </button>
          )}
          <button
            className="update-card-btn update-card-btn--ghost"
            onClick={onDismiss}
            type="button"
          >
            {t.dismiss}
          </button>
        </div>
      )}

      {isError && (
        <>
          <div className="update-card-error-msg">
            {errorMessage ?? t.unknownError}
          </div>
          <div className="update-card-actions">
            {capability?.check && (
              <button
                className="update-card-btn update-card-btn--primary"
                onClick={onCheck}
                type="button"
              >
                {t.retry}
              </button>
            )}
            <button
              className="update-card-btn update-card-btn--ghost"
              onClick={onDismiss}
              type="button"
            >
              {t.dismiss}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
