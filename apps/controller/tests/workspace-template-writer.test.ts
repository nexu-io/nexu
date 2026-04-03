import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { WorkspaceTemplateWriter } from "../src/runtime/workspace-template-writer.js";

const USER_MD_TEMPLATE = `# USER.md - About Your Human

- **Name:**
- **What to call them:**
- **Timezone:**
- **Notes:**
`;

describe("WorkspaceTemplateWriter", () => {
  let rootDir: string;
  let templatesDir: string;
  let stateDir: string;
  let env: ControllerEnv;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-template-writer-"));
    templatesDir = path.join(rootDir, "templates");
    stateDir = path.join(rootDir, "state");
    await mkdir(templatesDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });

    env = {
      platformTemplatesDir: templatesDir,
      openclawStateDir: stateDir,
    } as ControllerEnv;
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("copies template files for a new bot workspace", async () => {
    await writeFile(path.join(templatesDir, "USER.md"), USER_MD_TEMPLATE);
    await writeFile(path.join(templatesDir, "AGENTS.md"), "# AGENTS.md\n");

    const writer = new WorkspaceTemplateWriter(env);
    await writer.write([{ id: "bot-1", status: "active" }]);

    const userMd = await readFile(path.join(stateDir, "agents", "bot-1", "USER.md"), "utf8");
    expect(userMd).toBe(USER_MD_TEMPLATE);

    const agentsMd = await readFile(path.join(stateDir, "agents", "bot-1", "AGENTS.md"), "utf8");
    expect(agentsMd).toBe("# AGENTS.md\n");
  });

  it("does not overwrite existing files (preserves agent-written data)", async () => {
    await writeFile(path.join(templatesDir, "USER.md"), USER_MD_TEMPLATE);

    const writer = new WorkspaceTemplateWriter(env);
    await writer.write([{ id: "bot-1", status: "active" }]);

    // Simulate agent writing user data to USER.md
    const agentWrittenContent = "# USER.md\n- **Name:** Alice\n- **Timezone:** Asia/Shanghai\n";
    await writeFile(path.join(stateDir, "agents", "bot-1", "USER.md"), agentWrittenContent);

    // Second write: triggered by connecting a new channel
    await writer.write([{ id: "bot-1", status: "active" }]);

    // USER.md should still contain agent-written data, not the empty template
    const userMd = await readFile(path.join(stateDir, "agents", "bot-1", "USER.md"), "utf8");
    expect(userMd).toBe(agentWrittenContent);
  });

  it("skips inactive bots", async () => {
    await writeFile(path.join(templatesDir, "USER.md"), "# USER.md\n");

    const writer = new WorkspaceTemplateWriter(env);
    await writer.write([{ id: "bot-1", status: "inactive" }]);

    const workspaceDir = path.join(stateDir, "agents", "bot-1");
    await expect(
      readFile(path.join(workspaceDir, "USER.md"), "utf8"),
    ).rejects.toThrow();
  });

  it("writes new template files without affecting existing ones", async () => {
    await writeFile(path.join(templatesDir, "USER.md"), USER_MD_TEMPLATE);

    const writer = new WorkspaceTemplateWriter(env);
    await writer.write([{ id: "bot-1", status: "active" }]);

    // Agent updates USER.md
    const agentContent = "# USER.md\n- **Name:** Bob\n";
    await writeFile(path.join(stateDir, "agents", "bot-1", "USER.md"), agentContent);

    // Add a new template file (simulates Nexu upgrade adding TOOLS.md)
    await writeFile(path.join(templatesDir, "TOOLS.md"), "# TOOLS.md\n");

    // Write again: should add TOOLS.md but not overwrite USER.md
    await writer.write([{ id: "bot-1", status: "active" }]);

    const userMd = await readFile(path.join(stateDir, "agents", "bot-1", "USER.md"), "utf8");
    expect(userMd).toBe(agentContent);

    const toolsMd = await readFile(path.join(stateDir, "agents", "bot-1", "TOOLS.md"), "utf8");
    expect(toolsMd).toBe("# TOOLS.md\n");
  });

  it("pre-fills USER.md with user identity on first write", async () => {
    await writeFile(path.join(templatesDir, "USER.md"), USER_MD_TEMPLATE);

    const writer = new WorkspaceTemplateWriter(env);
    await writer.write(
      [{ id: "bot-1", status: "active" }],
      { name: "Alice", timezone: "Asia/Shanghai" },
    );

    const userMd = await readFile(path.join(stateDir, "agents", "bot-1", "USER.md"), "utf8");
    expect(userMd).toContain("- **Name:** Alice");
    expect(userMd).toContain("- **What to call them:** Alice");
    expect(userMd).toContain("- **Timezone:** Asia/Shanghai");
  });

  it("does not pre-fill when name is default 'Desktop User'", async () => {
    await writeFile(path.join(templatesDir, "USER.md"), USER_MD_TEMPLATE);

    const writer = new WorkspaceTemplateWriter(env);
    await writer.write(
      [{ id: "bot-1", status: "active" }],
      { name: "Desktop User", timezone: "Asia/Shanghai" },
    );

    const userMd = await readFile(path.join(stateDir, "agents", "bot-1", "USER.md"), "utf8");
    // Name should remain empty (default), but timezone should be filled
    expect(userMd).toContain("- **Name:**\n");
    expect(userMd).toContain("- **Timezone:** Asia/Shanghai");
  });

  it("does not overwrite agent-written fields during pre-fill", async () => {
    await writeFile(path.join(templatesDir, "USER.md"), USER_MD_TEMPLATE);

    const writer = new WorkspaceTemplateWriter(env);
    // First write with pre-fill
    await writer.write(
      [{ id: "bot-1", status: "active" }],
      { name: "Alice", timezone: "Asia/Shanghai" },
    );

    // Agent updates USER.md with richer info
    const agentContent = "# USER.md\n- **Name:** Alice Tang\n- **Timezone:** America/New_York\n";
    await writeFile(path.join(stateDir, "agents", "bot-1", "USER.md"), agentContent);

    // Second write: should not overwrite agent data
    await writer.write(
      [{ id: "bot-1", status: "active" }],
      { name: "Alice", timezone: "Asia/Shanghai" },
    );

    const userMd = await readFile(path.join(stateDir, "agents", "bot-1", "USER.md"), "utf8");
    expect(userMd).toBe(agentContent);
  });
});
