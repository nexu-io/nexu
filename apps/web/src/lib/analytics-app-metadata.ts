import webPackageJson from "../../package.json";

type AnalyticsAppMetadata = {
  appName: string;
  appVersion: string;
};

type NexuHostBootstrap = {
  buildInfo?: {
    version?: unknown;
  };
};

function getDesktopBootstrap(): NexuHostBootstrap | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = (
    window as Window & {
      nexuHost?: {
        bootstrap?: NexuHostBootstrap;
      };
    }
  ).nexuHost;

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  return candidate.bootstrap ?? null;
}

export function getAnalyticsAppMetadata(): AnalyticsAppMetadata {
  const desktopVersion = getDesktopBootstrap()?.buildInfo?.version;
  if (typeof desktopVersion === "string" && desktopVersion.length > 0) {
    return {
      appName: "nexu-desktop",
      appVersion: desktopVersion,
    };
  }

  return {
    appName: webPackageJson.name.replace("@nexu/", "nexu-"),
    appVersion: webPackageJson.version,
  };
}
