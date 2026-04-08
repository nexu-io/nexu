import { describe, expect, it } from "vitest";

import { createDesktopCommandSpec } from "../../apps/desktop/scripts/platforms/desktop-platform.mjs";

describe("desktop command spec", () => {
  it("passes through native commands on non-Windows platforms", () => {
    expect(createDesktopCommandSpec("mac", "pnpm", ["build"])).toEqual({
      command: "pnpm",
      args: ["build"],
    });
  });

  it("wraps pnpm commands with cmd.exe on Windows", () => {
    expect(
      createDesktopCommandSpec("win", "pnpm.cmd", [
        "--dir",
        "C:\\repo path",
        "--filter",
        "@nexu/shared",
        "build",
      ]),
    ).toEqual({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        'pnpm.cmd --dir "C:\\repo path" --filter @nexu/shared build',
      ],
    });
  });

  it("wraps other Windows shell entrypoints and preserves quoting", () => {
    expect(
      createDesktopCommandSpec("win", "C:\\Program Files\\tool\\run.cmd", [
        "value with spaces",
        'embedded"quote',
      ]),
    ).toEqual({
      command: "cmd.exe",
      args: [
        "/d",
        "/s",
        "/c",
        '"C:\\Program Files\\tool\\run.cmd" "value with spaces" "embedded""quote"',
      ],
    });
  });

  it("does not wrap native executables on Windows", () => {
    expect(createDesktopCommandSpec("win", "node.exe", ["script.js"])).toEqual({
      command: "node.exe",
      args: ["script.js"],
    });
  });
});
