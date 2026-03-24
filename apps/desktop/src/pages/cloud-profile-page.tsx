import { type ChangeEvent, useCallback, useEffect, useState } from "react";
import {
  connectCloudProfile,
  createCloudProfile,
  deleteCloudProfile,
  disconnectCloudProfile,
  getDesktopCloudStatus,
  importCloudProfiles,
  openExternal,
  switchCloudProfile,
  updateCloudProfile,
} from "../lib/host-api";

type CloudStatus = {
  connected: boolean;
  polling?: boolean;
  userName?: string | null;
  userEmail?: string | null;
  connectedAt?: string | null;
  cloudUrl: string;
  linkUrl: string | null;
  activeProfileName: string;
  profiles: Array<{
    name: string;
    cloudUrl: string;
    linkUrl: string;
    connected: boolean;
    polling?: boolean;
    userName?: string | null;
    userEmail?: string | null;
    connectedAt?: string | null;
    modelCount: number;
  }>;
};

export function CloudProfilePage() {
  const [cloudStatus, setCloudStatus] = useState<CloudStatus | null>(null);
  const [cloudStatusPhase, setCloudStatusPhase] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCloudUrl, setDraftCloudUrl] = useState("");
  const [draftLinkUrl, setDraftLinkUrl] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createCloudUrl, setCreateCloudUrl] = useState("");
  const [createLinkUrl, setCreateLinkUrl] = useState("");

  const refreshCloudStatus = useCallback(
    async (options?: {
      silent?: boolean;
      loading?: boolean;
    }) => {
      if (options?.loading) {
        setCloudStatusPhase("loading");
      }

      try {
        const status = await getDesktopCloudStatus();
        setCloudStatus(status);
        setCloudStatusPhase("ready");
        if (!options?.silent) {
          setCloudMessage("Cloud profiles synced.");
        }
      } catch (error) {
        setCloudStatusPhase("error");
        if (!options?.silent) {
          setCloudMessage(
            error instanceof Error
              ? error.message
              : "Failed to load cloud status.",
          );
        }
        throw error;
      }
    },
    [],
  );

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        const status = await getDesktopCloudStatus();
        if (isCancelled) {
          return;
        }

        setCloudStatus(status);
        setCloudStatusPhase("ready");
      } catch (error) {
        if (isCancelled) {
          return;
        }

        setCloudStatusPhase("error");
        setCloudMessage(
          error instanceof Error
            ? error.message
            : "Failed to load cloud status.",
        );
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleWindowFocus() {
      void refreshCloudStatus({ silent: true, loading: false });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshCloudStatus({ silent: true, loading: false });
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshCloudStatus]);

  useEffect(() => {
    const isPolling =
      cloudStatus?.profiles.some((profile) => profile.polling) ?? false;

    if (!isPolling) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshCloudStatus({ silent: true, loading: false });
    }, 2000);

    return () => {
      window.clearInterval(interval);
    };
  }, [cloudStatus?.profiles, refreshCloudStatus]);

  async function handleCloudProfileChange(name: string) {
    if (cloudBusy || cloudStatus?.activeProfileName === name) {
      return;
    }

    setCloudBusy(true);
    setCloudMessage(null);
    try {
      const next = await switchCloudProfile(name);
      setCloudStatus(next);
      setCloudMessage(`Switched to ${name}.`);
    } catch (error) {
      setCloudMessage(
        error instanceof Error
          ? error.message
          : "Failed to switch cloud profile.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleConnectProfile(name: string) {
    setCloudBusy(true);
    setCloudMessage(null);
    try {
      const result = await connectCloudProfile(name);
      setCloudStatus(result.status);
      if (result.browserUrl) {
        await openExternal(result.browserUrl);
        setCloudMessage(`Opened browser sign-in for ${name}.`);
      } else {
        setCloudMessage(`Connected ${name}.`);
      }
    } catch (error) {
      setCloudMessage(
        error instanceof Error
          ? error.message
          : "Failed to connect cloud profile.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleDisconnectProfile(name: string) {
    setCloudBusy(true);
    setCloudMessage(null);
    try {
      const next = await disconnectCloudProfile(name);
      setCloudStatus(next);
      setCloudMessage(`Disconnected ${name}.`);
    } catch (error) {
      setCloudMessage(
        error instanceof Error
          ? error.message
          : "Failed to disconnect cloud profile.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleImportProfiles(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setCloudBusy(true);
    setCloudMessage(null);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("Cloud profile import must be a JSON array.");
      }

      const profiles = parsed.map((item) => {
        if (typeof item !== "object" || item === null) {
          throw new Error(
            "Each cloud profile must include name, cloudUrl, and linkUrl.",
          );
        }

        const candidate = item as Record<string, unknown>;
        if (
          typeof candidate.name !== "string" ||
          typeof candidate.cloudUrl !== "string" ||
          typeof candidate.linkUrl !== "string"
        ) {
          throw new Error(
            "Each cloud profile must include name, cloudUrl, and linkUrl.",
          );
        }

        return {
          name: candidate.name,
          cloudUrl: candidate.cloudUrl,
          linkUrl: candidate.linkUrl,
        };
      });

      const next = await importCloudProfiles(profiles);
      setCloudStatus(next);
      setCloudMessage(`Imported ${profiles.length} profile(s).`);
    } catch (error) {
      setCloudMessage(
        error instanceof Error
          ? error.message
          : "Failed to import cloud profiles.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  function beginEdit(profile: CloudStatus["profiles"][number]) {
    setEditingName(profile.name);
    setDraftName(profile.name);
    setDraftCloudUrl(profile.cloudUrl);
    setDraftLinkUrl(profile.linkUrl);
    setCloudMessage(null);
  }

  function cancelEdit() {
    setEditingName(null);
    setDraftName("");
    setDraftCloudUrl("");
    setDraftLinkUrl("");
  }

  async function handleSaveProfile() {
    if (!editingName) {
      return;
    }

    setCloudBusy(true);
    setCloudMessage(null);
    try {
      const next = await updateCloudProfile(editingName, {
        name: draftName,
        cloudUrl: draftCloudUrl,
        linkUrl: draftLinkUrl,
      });
      setCloudStatus(next);
      setCloudMessage(`Updated ${draftName}.`);
      cancelEdit();
    } catch (error) {
      setCloudMessage(
        error instanceof Error
          ? error.message
          : "Failed to update cloud profile.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleCreateProfile() {
    setCloudBusy(true);
    setCloudMessage(null);
    try {
      const next = await createCloudProfile({
        name: createName,
        cloudUrl: createCloudUrl,
        linkUrl: createLinkUrl,
      });
      setCloudStatus(next);
      setCloudMessage(`Created ${createName}.`);
      setIsCreateModalOpen(false);
      setCreateName("");
      setCreateCloudUrl("");
      setCreateLinkUrl("");
    } catch (error) {
      setCloudMessage(
        error instanceof Error
          ? error.message
          : "Failed to create cloud profile.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  async function handleDeleteProfile(name: string) {
    if (name === "Default") {
      return;
    }

    setCloudBusy(true);
    setCloudMessage(null);
    try {
      const next = await deleteCloudProfile(name);
      setCloudStatus(next);
      setCloudMessage(`Deleted ${name}.`);
      if (editingName === name) {
        cancelEdit();
      }
    } catch (error) {
      setCloudMessage(
        error instanceof Error
          ? error.message
          : "Failed to delete cloud profile.",
      );
    } finally {
      setCloudBusy(false);
    }
  }

  function handleExportProfiles() {
    const profiles = (cloudStatus?.profiles ?? [])
      .filter((profile) => profile.name !== "Default")
      .map((profile) => ({
        name: profile.name,
        cloudUrl: profile.cloudUrl,
        linkUrl: profile.linkUrl,
      }));
    const blob = new Blob([`${JSON.stringify(profiles, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cloud-profiles.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setCloudMessage(`Exported ${profiles.length} custom profile(s).`);
  }

  const statusBannerTone =
    cloudStatusPhase === "loading"
      ? "loading"
      : cloudStatusPhase === "error"
        ? "error"
        : cloudBusy
          ? "loading"
          : "ready";

  const statusBannerMessage =
    cloudMessage ??
    (cloudStatusPhase === "loading"
      ? "Loading cloud profiles..."
      : cloudStatusPhase === "error"
        ? "Controller not ready yet. Retrying in a moment may help."
        : cloudBusy
          ? "Applying cloud profile change..."
          : "Cloud profiles are ready.");

  return (
    <div className="runtime-page cloud-profile-page">
      <header className="runtime-header cloud-profile-header">
        <div>
          <span className="runtime-eyebrow">Cloud Profile</span>
          <h1>Cloud profile switcher</h1>
          <p>
            Switch cloud + link endpoints while keeping the current cloud login.
          </p>
        </div>
      </header>

      <section className="cloud-profile-card">
        <div className="cloud-profile-section-head">
          <strong>Profiles</strong>
          <span>Import a JSON array or switch to any saved profile.</span>
        </div>
        <div className="cloud-profile-actions-row">
          <button
            className="cloud-profile-import-button is-primary"
            disabled={cloudBusy}
            onClick={() => setIsCreateModalOpen(true)}
            type="button"
          >
            New Profile
          </button>
          <label className="cloud-profile-import-button">
            <input
              accept="application/json"
              className="cloud-profile-file-input"
              disabled={cloudBusy}
              onChange={(event) => void handleImportProfiles(event)}
              type="file"
            />
            Import JSON
          </label>
          <button
            className="cloud-profile-import-button"
            disabled={cloudBusy}
            onClick={handleExportProfiles}
            type="button"
          >
            Export JSON
          </button>
        </div>
        <div className="cloud-profile-list" aria-label="Cloud profiles">
          {(cloudStatus?.profiles ?? []).map((profile) => (
            <div
              className={
                cloudStatus?.activeProfileName === profile.name
                  ? "cloud-profile-list-item is-active"
                  : "cloud-profile-list-item"
              }
              key={profile.name}
            >
              <button
                className="cloud-profile-list-main"
                disabled={cloudBusy}
                onClick={() => void handleCloudProfileChange(profile.name)}
                type="button"
              >
                <div className="cloud-profile-list-main-top">
                  <span
                    className={
                      profile.polling
                        ? "cloud-profile-inline-dot is-loading"
                        : profile.connected
                          ? "cloud-profile-inline-dot is-connected"
                          : "cloud-profile-inline-dot"
                    }
                  />
                  <strong>{profile.name}</strong>
                  <span className="cloud-profile-model-count">
                    {profile.modelCount} model
                    {profile.modelCount === 1 ? "" : "s"}
                  </span>
                  {cloudStatus?.activeProfileName === profile.name ? (
                    <span className="cloud-profile-active-badge">Active</span>
                  ) : null}
                </div>
                <span className="cloud-profile-list-account">
                  {profile.userEmail ??
                    profile.userName ??
                    (profile.connected ? "Connected" : "Not connected")}
                </span>
                <span className="cloud-profile-list-url">
                  Cloud · {profile.cloudUrl}
                </span>
                <span className="cloud-profile-list-url">
                  Link · {profile.linkUrl}
                </span>
              </button>
              <div className="cloud-profile-item-actions">
                <button
                  className={
                    profile.connected
                      ? "cloud-profile-item-action is-connect"
                      : "cloud-profile-item-action is-primary-action"
                  }
                  disabled={cloudBusy || profile.polling}
                  onClick={() =>
                    void (profile.connected
                      ? handleDisconnectProfile(profile.name)
                      : handleConnectProfile(profile.name))
                  }
                  type="button"
                >
                  {profile.polling
                    ? "Connecting..."
                    : profile.connected
                      ? "Disconnect"
                      : "Connect"}
                </button>
                {profile.name !== "Default" ? (
                  <>
                    <button
                      className="cloud-profile-item-action"
                      disabled={cloudBusy}
                      onClick={() => beginEdit(profile)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="cloud-profile-item-action is-danger"
                      disabled={cloudBusy}
                      onClick={() => void handleDeleteProfile(profile.name)}
                      type="button"
                    >
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {editingName ? (
        <section className="cloud-profile-card">
          <div className="cloud-profile-section-head">
            <strong>Edit Profile</strong>
            <span>Update one custom profile at a time.</span>
          </div>
          <div className="cloud-profile-form-grid">
            <label>
              <span>Name</span>
              <input
                onChange={(event) => setDraftName(event.target.value)}
                value={draftName}
              />
            </label>
            <label>
              <span>Cloud URL</span>
              <input
                onChange={(event) => setDraftCloudUrl(event.target.value)}
                value={draftCloudUrl}
              />
            </label>
            <label>
              <span>Link URL</span>
              <input
                onChange={(event) => setDraftLinkUrl(event.target.value)}
                value={draftLinkUrl}
              />
            </label>
          </div>
          <div className="cloud-profile-form-actions">
            <button
              className="cloud-profile-import-button"
              disabled={cloudBusy}
              onClick={() => void handleSaveProfile()}
              type="button"
            >
              Save
            </button>
            <button
              className="cloud-profile-item-action"
              disabled={cloudBusy}
              onClick={cancelEdit}
              type="button"
            >
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {isCreateModalOpen ? (
        <div className="cloud-profile-modal-backdrop" role="presentation">
          <dialog className="cloud-profile-modal" open>
            <div className="cloud-profile-modal-header">
              <div>
                <strong>Create Cloud Profile</strong>
                <p>Add a new named cloud/link endpoint pair.</p>
              </div>
              <button
                className="cloud-profile-modal-close"
                disabled={cloudBusy}
                onClick={() => setIsCreateModalOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="cloud-profile-form-grid cloud-profile-modal-form">
              <label>
                <span>Name</span>
                <input
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="Staging"
                  value={createName}
                />
              </label>
              <label>
                <span>Cloud URL</span>
                <input
                  onChange={(event) => setCreateCloudUrl(event.target.value)}
                  placeholder="https://nexu.example.com"
                  value={createCloudUrl}
                />
              </label>
              <label>
                <span>Link URL</span>
                <input
                  onChange={(event) => setCreateLinkUrl(event.target.value)}
                  placeholder="https://link.example.com"
                  value={createLinkUrl}
                />
              </label>
            </div>
            <div className="cloud-profile-form-actions cloud-profile-modal-actions">
              <button
                className="cloud-profile-item-action"
                disabled={cloudBusy}
                onClick={() => setIsCreateModalOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="cloud-profile-import-button is-primary"
                disabled={
                  cloudBusy ||
                  createName.trim().length === 0 ||
                  createCloudUrl.trim().length === 0 ||
                  createLinkUrl.trim().length === 0
                }
                onClick={() => void handleCreateProfile()}
                type="button"
              >
                Create Profile
              </button>
            </div>
          </dialog>
        </div>
      ) : null}

      {cloudMessage ? (
        <p className={`runtime-cloud-message is-${statusBannerTone}`}>
          <span
            className={`runtime-cloud-message-dot is-${statusBannerTone}`}
            aria-hidden="true"
          />
          <span>{statusBannerMessage}</span>
        </p>
      ) : (
        <p className={`runtime-cloud-message is-${statusBannerTone}`}>
          <span
            className={`runtime-cloud-message-dot is-${statusBannerTone}`}
            aria-hidden="true"
          />
          <span>{statusBannerMessage}</span>
        </p>
      )}
    </div>
  );
}
