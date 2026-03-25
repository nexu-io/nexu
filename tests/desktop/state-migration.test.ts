/**
 * State migration tests — covers v0.1.5→v0.1.6 state merge logic.
 */
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
  getLegacyNexuHomeStateDir,
  migrateOpenclawState,
} from "../../apps/desktop/main/services/state-migration";

let sourceDir: string;
let targetDir: string;
const logMessages: string[] = [];
const log = (msg: string) => logMessages.push(msg);

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "nexu-migration-"));
  sourceDir = join(base, "source");
  targetDir = join(base, "target");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(targetDir, { recursive: true });
  logMessages.length = 0;
});

afterEach(() => {
  try {
    rmSync(sourceDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  } catch {
    // cleanup best effort
  }
});

describe("migrateOpenclawState", () => {
  it("copies agents from source to target when target is empty", () => {
    // Create source agent with session
    const agentDir = join(sourceDir, "agents", "agent-1", "sessions");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "session-1.json"), '{"data":"test"}');

    migrateOpenclawState({
      targetStateDir: targetDir,
      sourceStateDir: sourceDir,
      log,
    });

    expect(
      existsSync(
        join(targetDir, "agents", "agent-1", "sessions", "session-1.json"),
      ),
    ).toBe(true);
    expect(
      readFileSync(
        join(targetDir, "agents", "agent-1", "sessions", "session-1.json"),
        "utf-8",
      ),
    ).toBe('{"data":"test"}');
  });

  it("does not overwrite existing sessions in target", () => {
    // Source has session-1
    const sourceAgent = join(sourceDir, "agents", "agent-1", "sessions");
    mkdirSync(sourceAgent, { recursive: true });
    writeFileSync(join(sourceAgent, "session-1.json"), '{"from":"source"}');

    // Target already has session-1 with different content
    const targetAgent = join(targetDir, "agents", "agent-1", "sessions");
    mkdirSync(targetAgent, { recursive: true });
    writeFileSync(join(targetAgent, "session-1.json"), '{"from":"target"}');

    migrateOpenclawState({
      targetStateDir: targetDir,
      sourceStateDir: sourceDir,
      log,
    });

    // Target's version should be preserved
    expect(readFileSync(join(targetAgent, "session-1.json"), "utf-8")).toBe(
      '{"from":"target"}',
    );
  });

  it("merges new sessions from source into existing target agent", () => {
    // Source has session-1 and session-2
    const sourceAgent = join(sourceDir, "agents", "agent-1", "sessions");
    mkdirSync(sourceAgent, { recursive: true });
    writeFileSync(join(sourceAgent, "session-1.json"), '{"from":"source"}');
    writeFileSync(join(sourceAgent, "session-2.json"), '{"from":"source-new"}');

    // Target only has session-1
    const targetAgent = join(targetDir, "agents", "agent-1", "sessions");
    mkdirSync(targetAgent, { recursive: true });
    writeFileSync(join(targetAgent, "session-1.json"), '{"from":"target"}');

    migrateOpenclawState({
      targetStateDir: targetDir,
      sourceStateDir: sourceDir,
      log,
    });

    // session-1 unchanged, session-2 copied
    expect(readFileSync(join(targetAgent, "session-1.json"), "utf-8")).toBe(
      '{"from":"target"}',
    );
    expect(readFileSync(join(targetAgent, "session-2.json"), "utf-8")).toBe(
      '{"from":"source-new"}',
    );
  });

  it("copies subdirectories (extensions, identity) if missing in target", () => {
    mkdirSync(join(sourceDir, "extensions", "feishu"), { recursive: true });
    writeFileSync(join(sourceDir, "extensions", "feishu", "state.json"), "{}");

    migrateOpenclawState({
      targetStateDir: targetDir,
      sourceStateDir: sourceDir,
      log,
    });

    expect(
      existsSync(join(targetDir, "extensions", "feishu", "state.json")),
    ).toBe(true);
  });

  it("skips migration if stamp file exists", () => {
    writeFileSync(join(targetDir, ".v016-migration-done"), "done");
    mkdirSync(join(sourceDir, "agents", "agent-1"), { recursive: true });

    migrateOpenclawState({
      targetStateDir: targetDir,
      sourceStateDir: sourceDir,
      log,
    });

    // Agent should NOT have been copied
    expect(existsSync(join(targetDir, "agents", "agent-1"))).toBe(false);
    expect(logMessages[0]).toContain("already completed");
  });

  it("writes stamp file after migration", () => {
    migrateOpenclawState({
      targetStateDir: targetDir,
      sourceStateDir: sourceDir,
      log,
    });

    expect(existsSync(join(targetDir, ".v016-migration-done"))).toBe(true);
  });

  it("handles missing source gracefully", () => {
    rmSync(sourceDir, { recursive: true, force: true });

    migrateOpenclawState({
      targetStateDir: targetDir,
      sourceStateDir: sourceDir,
      log,
    });

    expect(logMessages[0]).toContain("source not found");
    // Stamp should still be written
    expect(existsSync(join(targetDir, ".v016-migration-done"))).toBe(true);
  });
});

describe("getLegacyNexuHomeStateDir", () => {
  it("expands ~ to homedir", () => {
    const dir = getLegacyNexuHomeStateDir("~/.nexu");
    expect(dir).toContain("runtime/openclaw/state");
    expect(dir).not.toContain("~");
  });

  it("handles absolute paths without tilde", () => {
    const dir = getLegacyNexuHomeStateDir("/custom/nexu");
    expect(dir).toBe("/custom/nexu/runtime/openclaw/state");
  });
});
