export function getDesktopPlatform(): string | null {
  const value = import.meta.env.VITE_DESKTOP_PLATFORM;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function isWindowsDesktopPlatform(): boolean {
  return getDesktopPlatform() === "win32";
}
