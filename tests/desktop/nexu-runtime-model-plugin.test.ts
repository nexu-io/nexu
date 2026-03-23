import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const pluginModulePath = path.resolve(
  testDir,
  "../../apps/controller/static/runtime-plugins/nexu-runtime-model/index.js",
);
const stateModulePath = path.resolve(
  testDir,
  "../../apps/controller/static/nexu-runtime-model.json",
);

async function writeState(selectedModelRef: string) {
  await writeFile(
    stateModulePath,
    `${JSON.stringify(
      {
        selectedModelRef,
        promptNotice: `Authoritative runtime model for this turn: ${selectedModelRef}.`,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

describe("nexu-runtime-model plugin", () => {
  let beforeState: string | null = null;

  beforeEach(async () => {
    try {
      beforeState = await readFile(stateModulePath, "utf8");
    } catch {
      beforeState = null;
    }
  });

  afterEach(async () => {
    if (beforeState === null) {
      await unlink(stateModulePath).catch(() => undefined);
      return;
    }
    await writeFile(stateModulePath, beforeState, "utf8");
  });

  it("keeps custom provider overrides as embedded model refs", async () => {
    await writeState(
      "custom_e00c608f-34a4-4979-b063-b82c243d8c69/anthropic/claude-3.7-sonnet",
    );

    const { default: plugin } = await import(
      `${pluginModulePath}?t=${Date.now()}`
    );
    let beforeModelResolveHandler:
      | (() => Promise<Record<string, string> | undefined>)
      | undefined;

    plugin.register({
      on(event, handler) {
        if (event === "before_model_resolve") {
          beforeModelResolveHandler = handler;
        }
      },
    });

    const result = await beforeModelResolveHandler?.();

    expect(result).toEqual({
      modelOverride: "anthropic/claude-3.7-sonnet",
    });
  });

  it("preserves provider overrides for Link and proxied BYOK providers", async () => {
    const { default: plugin } = await import(
      `${pluginModulePath}?t=${Date.now()}`
    );

    await writeState("link/claude-sonnet-4");
    let linkHandler:
      | (() => Promise<Record<string, string> | undefined>)
      | undefined;
    plugin.register({
      on(event, handler) {
        if (event === "before_model_resolve") {
          linkHandler = handler;
        }
      },
    });
    expect(await linkHandler?.()).toEqual({
      providerOverride: "link",
      modelOverride: "claude-sonnet-4",
    });

    await writeState("byok_openai/openai/gpt-4.1");
    let byokHandler:
      | (() => Promise<Record<string, string> | undefined>)
      | undefined;
    plugin.register({
      on(event, handler) {
        if (event === "before_model_resolve") {
          byokHandler = handler;
        }
      },
    });
    expect(await byokHandler?.()).toEqual({
      providerOverride: "byok_openai",
      modelOverride: "openai/gpt-4.1",
    });
  });
});
