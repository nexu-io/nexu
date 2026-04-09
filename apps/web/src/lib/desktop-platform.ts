export function getDesktopPlatform(): string | null {
  // Prefer the build-time env injected by desktop packaging / dev scripts.
  const envValue = import.meta.env.VITE_DESKTOP_PLATFORM;
  if (typeof envValue === "string" && envValue.trim().length > 0) {
    return envValue;
  }
  // Fallback: detect at runtime via navigator so dev-mode webviews
  // (where Vite may not receive the env) still get the correct platform.
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("win")) return "win32";
    if (ua.includes("mac")) return "darwin";
    if (ua.includes("linux")) return "linux";
  }
  return null;
}

export function isWindowsDesktopPlatform(): boolean {
  return getDesktopPlatform() === "win32";
}

export function isMacDesktopPlatform(): boolean {
  return getDesktopPlatform() === "darwin";
}
