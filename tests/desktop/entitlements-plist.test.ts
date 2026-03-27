/**
 * macOS Entitlements Plist Guard Tests
 *
 * These tests prevent regressions in the code signing entitlements that
 * caused the nightly white-screen incident (d677733d):
 *
 * Root cause: entitlements.mac.inherit.plist was changed to only contain
 * com.apple.security.inherit, dropping allow-jit. On macOS 14.7.4+,
 * inherit alone does NOT propagate allow-jit to child processes (renderer,
 * helpers). Without allow-jit, V8 cannot mmap CodeRange with MAP_JIT →
 * renderer crashes → white screen.
 *
 * Critical invariants:
 *  1. Parent plist must have allow-jit (main process V8)
 *  2. Inherit plist must have allow-jit (renderer/helper V8)
 *  3. Both plists must have allow-unsigned-executable-memory (V8 fallback)
 *  4. Inherit plist must retain com.apple.security.inherit
 *  5. electron-builder config must reference both plist files
 *  6. Parent and inherit plists must be valid XML
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DESKTOP_ROOT = resolve(__dirname, "../../apps/desktop");

function readPlist(filename: string): string {
  return readFileSync(resolve(DESKTOP_ROOT, "build", filename), "utf8");
}

function plistHasKey(plistContent: string, key: string): boolean {
  return plistContent.includes(`<key>${key}</key>`);
}

describe("macOS Entitlements — V8 JIT requirements", () => {
  const parentPlist = readPlist("entitlements.mac.plist");
  const inheritPlist = readPlist("entitlements.mac.inherit.plist");

  // -------------------------------------------------------------------------
  // 1. Parent (main process) must have allow-jit
  // -------------------------------------------------------------------------
  it("parent plist grants allow-jit for V8 JIT compilation", () => {
    expect(plistHasKey(parentPlist, "com.apple.security.cs.allow-jit")).toBe(
      true,
    );
  });

  // -------------------------------------------------------------------------
  // 2. Inherit (renderer/helper) must have allow-jit
  //    This is THE fix for the white-screen regression — macOS 14.7.4+ does
  //    not reliably inherit allow-jit from parent via inherit alone.
  // -------------------------------------------------------------------------
  it("inherit plist explicitly grants allow-jit (macOS 14.7.4+ regression guard)", () => {
    expect(plistHasKey(inheritPlist, "com.apple.security.cs.allow-jit")).toBe(
      true,
    );
  });

  // -------------------------------------------------------------------------
  // 3. Both must have allow-unsigned-executable-memory
  // -------------------------------------------------------------------------
  it("parent plist grants allow-unsigned-executable-memory", () => {
    expect(
      plistHasKey(
        parentPlist,
        "com.apple.security.cs.allow-unsigned-executable-memory",
      ),
    ).toBe(true);
  });

  it("inherit plist grants allow-unsigned-executable-memory", () => {
    expect(
      plistHasKey(
        inheritPlist,
        "com.apple.security.cs.allow-unsigned-executable-memory",
      ),
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. Inherit plist must retain com.apple.security.inherit
  // -------------------------------------------------------------------------
  it("inherit plist retains com.apple.security.inherit", () => {
    expect(plistHasKey(inheritPlist, "com.apple.security.inherit")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. electron-builder config references both plists
  // -------------------------------------------------------------------------
  it("electron-builder config references both entitlement files", () => {
    const packageJson = readFileSync(
      resolve(DESKTOP_ROOT, "package.json"),
      "utf8",
    );
    const config = JSON.parse(packageJson) as Record<string, unknown>;
    const build = config.build as Record<string, unknown>;
    const mac = build.mac as Record<string, unknown>;

    expect(mac.entitlements).toBe("build/entitlements.mac.plist");
    expect(mac.entitlementsInherit).toBe(
      "build/entitlements.mac.inherit.plist",
    );
  });

  // -------------------------------------------------------------------------
  // 6. Both plists are valid XML with plist root
  // -------------------------------------------------------------------------
  it("parent plist is valid plist XML", () => {
    expect(parentPlist).toContain('<?xml version="1.0"');
    expect(parentPlist).toContain("<plist");
    expect(parentPlist).toContain("<dict>");
    expect(parentPlist).toContain("</dict>");
    expect(parentPlist).toContain("</plist>");
  });

  it("inherit plist is valid plist XML", () => {
    expect(inheritPlist).toContain('<?xml version="1.0"');
    expect(inheritPlist).toContain("<plist");
    expect(inheritPlist).toContain("<dict>");
    expect(inheritPlist).toContain("</dict>");
    expect(inheritPlist).toContain("</plist>");
  });

  // -------------------------------------------------------------------------
  // 7. Parent plist has disable-library-validation (needed for native addons)
  // -------------------------------------------------------------------------
  it("parent plist grants disable-library-validation for native addons", () => {
    expect(
      plistHasKey(
        parentPlist,
        "com.apple.security.cs.disable-library-validation",
      ),
    ).toBe(true);
  });
});
