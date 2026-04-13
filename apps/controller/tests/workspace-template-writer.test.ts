import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { WorkspaceTemplateWriter } from "../src/runtime/workspace-template-writer.js";

describe("WorkspaceTemplateWriter", () => {
  let rootDir = "";
  let sourceDir = "";
  let stateDir = "";
  let env: ControllerEnv;

  beforeEach(async () => {
    rootDir = await mkdtemp(
      path.join(tmpdir(), "nexu-workspace-template-writer-"),
    );
    sourceDir = path.join(rootDir, "platform-templates");
    stateDir = path.join(rootDir, ".openclaw");

    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      path.join(sourceDir, "AGENTS.md"),
      "# AGENTS template\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "IDENTITY.md"),
      "# IDENTITY template\n",
      "utf8",
    );
    await writeFile(
      path.join(sourceDir, "SOUL.md"),
      "# SOUL template\n",
      "utf8",
    );

    env = {
      openclawStateDir: stateDir,
      platformTemplatesDir: sourceDir,
    } as unknown as ControllerEnv;
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function workspacePathFor(botId: string, fileName: string): string {
    return path.join(stateDir, "agents", botId, fileName);
  }

  it("seeds every template file when the workspace is empty", async () => {
    const writer = new WorkspaceTemplateWriter(env);

    await writer.write([{ id: "bot-empty", status: "active" }]);

    expect(
      await readFile(workspacePathFor("bot-empty", "AGENTS.md"), "utf8"),
    ).toBe("# AGENTS template\n");
    expect(
      await readFile(workspacePathFor("bot-empty", "IDENTITY.md"), "utf8"),
    ).toBe("# IDENTITY template\n");
    expect(
      await readFile(workspacePathFor("bot-empty", "SOUL.md"), "utf8"),
    ).toBe("# SOUL template\n");
  });

  it("never overwrites a file that already exists in the workspace", async () => {
    const writer = new WorkspaceTemplateWriter(env);
    const botId = "bot-self-edited";
    const workspaceDir = path.join(stateDir, "agents", botId);
    await mkdir(workspaceDir, { recursive: true });

    // Simulate the agent having edited every platform doc at runtime.
    const customAgents = "# my custom AGENTS content edited by the agent\n";
    const customIdentity = "# my custom IDENTITY edited by the agent\n";
    const customSoul = "# my custom SOUL edited by the agent\n";
    await writeFile(path.join(workspaceDir, "AGENTS.md"), customAgents, "utf8");
    await writeFile(
      path.join(workspaceDir, "IDENTITY.md"),
      customIdentity,
      "utf8",
    );
    await writeFile(path.join(workspaceDir, "SOUL.md"), customSoul, "utf8");

    await writer.write([{ id: botId, status: "active" }]);

    expect(await readFile(workspacePathFor(botId, "AGENTS.md"), "utf8")).toBe(
      customAgents,
    );
    expect(await readFile(workspacePathFor(botId, "IDENTITY.md"), "utf8")).toBe(
      customIdentity,
    );
    expect(await readFile(workspacePathFor(botId, "SOUL.md"), "utf8")).toBe(
      customSoul,
    );
  });

  it("seeds missing files while preserving pre-existing ones (mixed case)", async () => {
    const writer = new WorkspaceTemplateWriter(env);
    const botId = "bot-mixed";
    const workspaceDir = path.join(stateDir, "agents", botId);
    await mkdir(workspaceDir, { recursive: true });

    // Agent has edited IDENTITY.md but not the others.
    const customIdentity = "# IDENTITY edited\n";
    await writeFile(
      path.join(workspaceDir, "IDENTITY.md"),
      customIdentity,
      "utf8",
    );

    await writer.write([{ id: botId, status: "active" }]);

    // Pre-existing file preserved.
    expect(await readFile(workspacePathFor(botId, "IDENTITY.md"), "utf8")).toBe(
      customIdentity,
    );
    // Missing files seeded from the template source.
    expect(await readFile(workspacePathFor(botId, "AGENTS.md"), "utf8")).toBe(
      "# AGENTS template\n",
    );
    expect(await readFile(workspacePathFor(botId, "SOUL.md"), "utf8")).toBe(
      "# SOUL template\n",
    );
  });

  it("is idempotent across repeated invocations", async () => {
    const writer = new WorkspaceTemplateWriter(env);
    const botId = "bot-repeat";

    await writer.write([{ id: botId, status: "active" }]);

    // After the first seed, simulate the agent rewriting AGENTS.md.
    const customAgents = "# AGENTS rewritten by agent after first seed\n";
    await writeFile(
      path.join(stateDir, "agents", botId, "AGENTS.md"),
      customAgents,
      "utf8",
    );

    // A second write() — e.g. via an accidental re-seed — must not clobber it.
    await writer.write([{ id: botId, status: "active" }]);

    expect(await readFile(workspacePathFor(botId, "AGENTS.md"), "utf8")).toBe(
      customAgents,
    );
  });

  it("skips inactive bots", async () => {
    const writer = new WorkspaceTemplateWriter(env);

    await writer.write([{ id: "bot-paused", status: "paused" }]);

    // Workspace dir for the inactive bot should never have been created.
    await expect(
      readFile(workspacePathFor("bot-paused", "AGENTS.md"), "utf8"),
    ).rejects.toThrow();
  });
});
