import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getLegacyPackagedNexuHomeDir,
  migrateNexuHomeFromUserData,
} from "../../apps/desktop/main/services/nexu-home-migration";
import { getDesktopNexuHomeDir } from "../../apps/desktop/shared/desktop-paths";

let tempDir: string;
let sourceDir: string;
let targetDir: string;
const logMessages: string[] = [];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "nexu-home-migration-"));
  sourceDir = join(tempDir, "userData", ".nexu");
  targetDir = join(tempDir, "home", ".nexu");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(targetDir, { recursive: true });
  logMessages.length = 0;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("desktop nexu home paths", () => {
  it("resolves packaged nexu home to ~/.nexu instead of userData/.nexu", () => {
    const userDataPath = join(
      tempDir,
      "Library",
      "Application Support",
      "@nexu",
      "desktop",
    );
    expect(getDesktopNexuHomeDir(userDataPath)).toBe(
      join(process.env.HOME ?? "", ".nexu"),
    );
    expect(getDesktopNexuHomeDir(userDataPath)).not.toBe(
      join(userDataPath, ".nexu"),
    );
  });

  it("resolves the legacy packaged nexu home under userData", () => {
    const userDataPath = join(
      tempDir,
      "Library",
      "Application Support",
      "@nexu",
      "desktop",
    );
    expect(getLegacyPackagedNexuHomeDir(userDataPath)).toBe(
      join(userDataPath, ".nexu"),
    );
  });
});

describe("migrateNexuHomeFromUserData", () => {
  it("merges config.json from legacy userData home into ~/.nexu", () => {
    writeFileSync(
      join(sourceDir, "config.json"),
      JSON.stringify({
        channels: [{ id: "qq", botId: "bot-1", channelType: "qqbot" }],
        bots: [{ id: "bot-1", name: "QQ Bot" }],
        templates: { foo: { id: "foo", name: "foo" } },
      }),
      "utf8",
    );
    writeFileSync(
      join(targetDir, "config.json"),
      JSON.stringify({
        channels: [{ id: "feishu", botId: "bot-2", channelType: "feishu" }],
        bots: [{ id: "bot-2", name: "Feishu Bot" }],
      }),
      "utf8",
    );

    migrateNexuHomeFromUserData({
      sourceNexuHome: sourceDir,
      targetNexuHome: targetDir,
      log: (message) => logMessages.push(message),
    });

    const merged = JSON.parse(
      readFileSync(join(targetDir, "config.json"), "utf8"),
    ) as {
      channels: Array<{ id: string }>;
      bots: Array<{ id: string }>;
      templates: Record<string, unknown>;
    };
    expect(merged.channels.map((channel) => channel.id).sort()).toEqual([
      "feishu",
      "qq",
    ]);
    expect(merged.bots.map((bot) => bot.id).sort()).toEqual(["bot-1", "bot-2"]);
    expect(Object.keys(merged.templates)).toContain("foo");
  });

  it("copies legacy metadata files and directories when missing", () => {
    writeFileSync(
      join(sourceDir, "compiled-openclaw.json"),
      JSON.stringify({ channels: { qqbot: {} } }),
      "utf8",
    );
    mkdirSync(join(sourceDir, "skillhub-cache"), { recursive: true });
    writeFileSync(
      join(sourceDir, "skillhub-cache", "index.json"),
      "{}",
      "utf8",
    );

    migrateNexuHomeFromUserData({
      sourceNexuHome: sourceDir,
      targetNexuHome: targetDir,
      log: (message) => logMessages.push(message),
    });

    expect(existsSync(join(targetDir, "compiled-openclaw.json"))).toBe(true);
    expect(existsSync(join(targetDir, "skillhub-cache", "index.json"))).toBe(
      true,
    );
  });

  it("writes a stamp and skips repeated migrations", () => {
    writeFileSync(
      join(sourceDir, "config.json"),
      JSON.stringify({ channels: [{ id: "qq" }] }),
      "utf8",
    );

    migrateNexuHomeFromUserData({
      sourceNexuHome: sourceDir,
      targetNexuHome: targetDir,
      log: (message) => logMessages.push(message),
    });

    writeFileSync(
      join(sourceDir, "config.json"),
      JSON.stringify({ channels: [{ id: "updated-after-stamp" }] }),
      "utf8",
    );

    migrateNexuHomeFromUserData({
      sourceNexuHome: sourceDir,
      targetNexuHome: targetDir,
      log: (message) => logMessages.push(message),
    });

    const merged = JSON.parse(
      readFileSync(join(targetDir, "config.json"), "utf8"),
    ) as { channels: Array<{ id: string }> };
    expect(merged.channels.map((channel) => channel.id)).toEqual(["qq"]);
    expect(
      logMessages.some((message) => message.includes("already completed")),
    ).toBe(true);
  });
});
