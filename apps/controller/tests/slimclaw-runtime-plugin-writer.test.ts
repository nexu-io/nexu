import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerEnv } from "../src/app/env.js";
import { OpenClawRuntimePluginWriter } from "../src/runtime/slimclaw-runtime-plugin-writer.js";

describe("OpenClawRuntimePluginWriter", () => {
  let rootDir: string;
  let env: ControllerEnv;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-runtime-plugin-writer-"));
    env = {
      bundledRuntimePluginsDir: path.join(rootDir, "bundled-plugins"),
      runtimePluginTemplatesDir: path.join(rootDir, "runtime-plugins"),
      openclawExtensionsDir: path.join(rootDir, "extensions"),
    } as ControllerEnv;
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("skips symlinked .bin entries while copying plugin directories", async () => {
    const pluginDir = path.join(env.runtimePluginTemplatesDir, "plugin-a");
    const nodeModulesDir = path.join(pluginDir, "node_modules");
    const realPackageDir = path.join(nodeModulesDir, "real-package");
    const realBinDir = path.join(rootDir, "shared-bin");

    await mkdir(realPackageDir, { recursive: true });
    await mkdir(realBinDir, { recursive: true });
    await writeFile(path.join(realPackageDir, "index.js"), "export {};\n");
    await writeFile(path.join(realBinDir, "tool"), "#!/usr/bin/env node\n");
    await symlink(realBinDir, path.join(nodeModulesDir, ".bin"));

    const writer = new OpenClawRuntimePluginWriter(env);
    await writer.ensurePlugins();

    await expect(
      access(
        path.join(
          env.openclawExtensionsDir,
          "plugin-a",
          "node_modules",
          "real-package",
          "index.js",
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      access(
        path.join(
          env.openclawExtensionsDir,
          "plugin-a",
          "node_modules",
          ".bin",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("materializes non-.bin symlinks as real directories", async () => {
    const pluginDir = path.join(env.runtimePluginTemplatesDir, "plugin-a");
    const sharedAssetsDir = path.join(rootDir, "shared-assets");

    await mkdir(pluginDir, { recursive: true });
    await mkdir(sharedAssetsDir, { recursive: true });
    await writeFile(path.join(sharedAssetsDir, "manifest.json"), "{\n}\n");
    await symlink(sharedAssetsDir, path.join(pluginDir, "shared-assets"));

    const writer = new OpenClawRuntimePluginWriter(env);
    await writer.ensurePlugins();

    const copiedPath = path.join(
      env.openclawExtensionsDir,
      "plugin-a",
      "shared-assets",
    );
    const copiedStat = await lstat(copiedPath);

    // dereference: true materializes symlinks into real directories
    expect(copiedStat.isSymbolicLink()).toBe(false);
    expect(copiedStat.isDirectory()).toBe(true);
    expect(await readFile(path.join(copiedPath, "manifest.json"), "utf8")).toBe(
      "{\n}\n",
    );
  });

  it("skips runtime plugins that already exist in builtin OpenClaw extensions", async () => {
    env = {
      ...env,
      openclawBuiltinExtensionsDir: path.join(rootDir, "builtin-extensions"),
    } as ControllerEnv;

    const runtimePluginDir = path.join(
      env.runtimePluginTemplatesDir,
      "whatsapp",
    );
    const builtinPluginDir = path.join(
      env.openclawBuiltinExtensionsDir,
      "whatsapp",
    );

    await mkdir(runtimePluginDir, { recursive: true });
    await mkdir(builtinPluginDir, { recursive: true });
    await writeFile(path.join(runtimePluginDir, "index.ts"), "export {};\n");
    await writeFile(path.join(builtinPluginDir, "index.ts"), "export {};\n");

    const writer = new OpenClawRuntimePluginWriter(env);
    await writer.ensurePlugins();

    await expect(
      access(path.join(env.openclawExtensionsDir, "whatsapp")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("removes stale runtime plugin copies when builtin extensions already provide them", async () => {
    env = {
      ...env,
      openclawBuiltinExtensionsDir: path.join(rootDir, "builtin-extensions"),
    } as ControllerEnv;

    const runtimePluginDir = path.join(
      env.runtimePluginTemplatesDir,
      "whatsapp",
    );
    const builtinPluginDir = path.join(
      env.openclawBuiltinExtensionsDir,
      "whatsapp",
    );
    const staleTargetDir = path.join(env.openclawExtensionsDir, "whatsapp");

    await mkdir(runtimePluginDir, { recursive: true });
    await mkdir(builtinPluginDir, { recursive: true });
    await mkdir(staleTargetDir, { recursive: true });
    await writeFile(path.join(runtimePluginDir, "index.ts"), "export {};\n");
    await writeFile(path.join(builtinPluginDir, "index.ts"), "export {};\n");
    await writeFile(path.join(staleTargetDir, "stale.txt"), "stale\n");

    const writer = new OpenClawRuntimePluginWriter(env);
    await writer.ensurePlugins();

    await expect(access(staleTargetDir)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("prefers bundled qqbot over the legacy runtime plugin source", async () => {
    const bundledPluginDir = path.join(
      env.bundledRuntimePluginsDir,
      "openclaw-qqbot",
    );
    const legacyPluginDir = path.join(
      env.runtimePluginTemplatesDir,
      "openclaw-qqbot",
    );

    await mkdir(bundledPluginDir, { recursive: true });
    await mkdir(legacyPluginDir, { recursive: true });
    await writeFile(
      path.join(bundledPluginDir, "manifest.txt"),
      "bundled\n",
      "utf8",
    );
    await writeFile(
      path.join(legacyPluginDir, "manifest.txt"),
      "legacy\n",
      "utf8",
    );

    const writer = new OpenClawRuntimePluginWriter(env);
    await writer.ensurePlugins();

    expect(
      await readFile(
        path.join(env.openclawExtensionsDir, "openclaw-qqbot", "manifest.txt"),
        "utf8",
      ),
    ).toBe("bundled\n");
  });

  it("keeps bundled qqbot runtime dependencies when materializing extensions", async () => {
    const bundledPluginDir = path.join(
      env.bundledRuntimePluginsDir,
      "openclaw-qqbot",
    );
    const bundledSilkWasmDir = path.join(
      bundledPluginDir,
      "node_modules",
      "silk-wasm",
    );

    await mkdir(bundledSilkWasmDir, { recursive: true });
    await writeFile(
      path.join(bundledSilkWasmDir, "package.json"),
      '{ "name": "silk-wasm" }\n',
      "utf8",
    );

    const writer = new OpenClawRuntimePluginWriter(env);
    await writer.ensurePlugins();

    expect(
      await readFile(
        path.join(
          env.openclawExtensionsDir,
          "openclaw-qqbot",
          "node_modules",
          "silk-wasm",
          "package.json",
        ),
        "utf8",
      ),
    ).toContain('"name": "silk-wasm"');
  });

  it("prefers bundled wecom over the legacy runtime plugin source", async () => {
    const bundledPluginDir = path.join(env.bundledRuntimePluginsDir, "wecom");
    const legacyPluginDir = path.join(env.runtimePluginTemplatesDir, "wecom");

    await mkdir(bundledPluginDir, { recursive: true });
    await mkdir(legacyPluginDir, { recursive: true });
    await writeFile(
      path.join(bundledPluginDir, "manifest.txt"),
      "bundled\n",
      "utf8",
    );
    await writeFile(
      path.join(legacyPluginDir, "manifest.txt"),
      "legacy\n",
      "utf8",
    );

    const writer = new OpenClawRuntimePluginWriter(env);
    await writer.ensurePlugins();

    expect(
      await readFile(
        path.join(env.openclawExtensionsDir, "wecom", "manifest.txt"),
        "utf8",
      ),
    ).toBe("bundled\n");
  });

  it("still copies legacy plugins when no bundled runtime artifact exists", async () => {
    const legacyPluginDir = path.join(
      env.runtimePluginTemplatesDir,
      "plugin-a",
    );

    await mkdir(legacyPluginDir, { recursive: true });
    await writeFile(path.join(legacyPluginDir, "index.js"), "export {};\n");

    const writer = new OpenClawRuntimePluginWriter(env);
    await writer.ensurePlugins();

    await expect(
      access(path.join(env.openclawExtensionsDir, "plugin-a", "index.js")),
    ).resolves.toBeUndefined();
  });
});
