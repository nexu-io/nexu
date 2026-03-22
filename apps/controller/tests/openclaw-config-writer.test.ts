import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "@nexu/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { OpenClawConfigWriter } from "../src/runtime/openclaw-config-writer.js";

function makeConfig(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return {
    gateway: { port: 18789, mode: "local", bind: "127.0.0.1" },
    agents: { list: [], defaults: {} },
    channels: {},
    bindings: [],
    plugins: { load: { paths: [] }, entries: {} },
    skills: { load: { watch: true } },
    commands: { native: "auto" },
    ...overrides,
  } as OpenClawConfig;
}

describe("OpenClawConfigWriter", () => {
  let rootDir: string;
  let env: ControllerEnv;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-config-writer-"));
    env = {
      openclawConfigPath: path.join(rootDir, ".openclaw", "openclaw.json"),
    } as ControllerEnv;
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("writes config file on first call", async () => {
    const writer = new OpenClawConfigWriter(env);
    const config = makeConfig();

    await writer.write(config);

    const written = await readFile(env.openclawConfigPath, "utf8");
    expect(JSON.parse(written)).toEqual(config);
  });

  it("skips write when content is unchanged", async () => {
    const writer = new OpenClawConfigWriter(env);
    const config = makeConfig();

    await writer.write(config);
    const firstStat = await stat(env.openclawConfigPath);

    // Small delay to ensure mtime would differ if a write happened
    await new Promise((r) => setTimeout(r, 50));

    await writer.write(config);
    const secondStat = await stat(env.openclawConfigPath);

    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it("writes when content changes", async () => {
    const writer = new OpenClawConfigWriter(env);

    const configA = makeConfig({ commands: { native: "auto" } });
    await writer.write(configA);
    const firstContent = await readFile(env.openclawConfigPath, "utf8");

    const configB = makeConfig({ commands: { native: "off" } });
    await writer.write(configB);
    const secondContent = await readFile(env.openclawConfigPath, "utf8");

    expect(firstContent).not.toBe(secondContent);
    expect(JSON.parse(secondContent)).toEqual(configB);
  });

  it("writes again after content changes back to original", async () => {
    const writer = new OpenClawConfigWriter(env);

    const configA = makeConfig({ commands: { native: "auto" } });
    const configB = makeConfig({ commands: { native: "off" } });

    await writer.write(configA);
    await writer.write(configB);
    const afterB = await readFile(env.openclawConfigPath, "utf8");
    expect(JSON.parse(afterB)).toEqual(configB);

    await writer.write(configA);
    const afterA = await readFile(env.openclawConfigPath, "utf8");
    expect(JSON.parse(afterA)).toEqual(configA);
  });

  it("skips write on repeated identical calls (restart loop scenario)", async () => {
    const writer = new OpenClawConfigWriter(env);
    const config = makeConfig();

    await writer.write(config);
    const firstStat = await stat(env.openclawConfigPath);

    await new Promise((r) => setTimeout(r, 50));

    // Simulate multiple syncAll() calls from WS reconnects
    await writer.write(config);
    await writer.write(config);
    await writer.write(config);

    const finalStat = await stat(env.openclawConfigPath);
    expect(finalStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it("new writer instance seeds cache from existing file on cold start", async () => {
    const config = makeConfig();

    const writer1 = new OpenClawConfigWriter(env);
    await writer1.write(config);
    const firstStat = await stat(env.openclawConfigPath);

    await new Promise((r) => setTimeout(r, 50));

    // A new writer instance reads the existing file to seed its cache,
    // so it skips the write when content matches (cold-start optimization).
    const writer2 = new OpenClawConfigWriter(env);
    await writer2.write(config);
    const secondStat = await stat(env.openclawConfigPath);

    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it("new writer instance writes when content differs from existing file", async () => {
    const configA = makeConfig({ commands: { native: "auto" } });
    const configB = makeConfig({ commands: { native: "off" } });

    const writer1 = new OpenClawConfigWriter(env);
    await writer1.write(configA);

    // A new writer reads the existing file, sees different content, and writes.
    const writer2 = new OpenClawConfigWriter(env);
    await writer2.write(configB);
    const written = await readFile(env.openclawConfigPath, "utf8");

    expect(JSON.parse(written)).toEqual(configB);
  });

  it("cold start with no existing file writes normally", async () => {
    // No file exists yet — writer should write without error.
    const writer = new OpenClawConfigWriter(env);
    const config = makeConfig();

    await writer.write(config);

    const written = await readFile(env.openclawConfigPath, "utf8");
    expect(JSON.parse(written)).toEqual(config);
  });
});
