import { describe, expect, it } from "vitest";
import { resolveWindowsPackagedUserDataPath } from "../../apps/desktop/main/platforms/windows/user-data-path";

describe("resolveWindowsPackagedUserDataPath", () => {
  it("uses the standard Roaming nexu-desktop path by default", () => {
    const result = resolveWindowsPackagedUserDataPath({
      appDataPath: "C:\\Users\\testuser\\AppData\\Roaming",
    });

    expect(result.defaultUserDataPath).toBe(
      "C:\\Users\\testuser\\AppData\\Roaming\\nexu-desktop",
    );
    expect(result.resolvedUserDataPath).toBe(
      "C:\\Users\\testuser\\AppData\\Roaming\\nexu-desktop",
    );
  });

  it("prefers the registry userData path over the default path", () => {
    const result = resolveWindowsPackagedUserDataPath({
      appDataPath: "C:\\Users\\testuser\\AppData\\Roaming",
      registryUserDataPath: "D:\\Nexu Data\\nexu-desktop",
    });

    expect(result.resolvedUserDataPath).toBe("D:\\Nexu Data\\nexu-desktop");
  });

  it("prefers the explicit override over the registry path", () => {
    const result = resolveWindowsPackagedUserDataPath({
      appDataPath: "C:\\Users\\testuser\\AppData\\Roaming",
      overrideUserDataPath: "E:\\Portable\\nexu-desktop",
      registryUserDataPath: "D:\\Nexu Data\\nexu-desktop",
    });

    expect(result.resolvedUserDataPath).toBe("E:\\Portable\\nexu-desktop");
  });

  it("does not consider the legacy @nexu\\desktop path", () => {
    const result = resolveWindowsPackagedUserDataPath({
      appDataPath: "C:\\Users\\testuser\\AppData\\Roaming",
    });

    expect(result.resolvedUserDataPath).not.toContain("@nexu");
  });
});
