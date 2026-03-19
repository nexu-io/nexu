import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerSkillhubRoutes } from "#api/routes/skillhub-routes.js";

function makeTempDir(): string {
  const dir = resolve(tmpdir(), `skillhub-routes-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkill(
  dir: string,
  slug: string,
  frontmatter?: { name?: string; description?: string },
): void {
  const skillDir = resolve(dir, slug);
  mkdirSync(skillDir, { recursive: true });

  const header = frontmatter
    ? [
        "---",
        `name: ${frontmatter.name ?? slug}`,
        `description: ${frontmatter.description ?? ""}`,
        "---",
        "",
      ].join("\n")
    : "";

  writeFileSync(resolve(skillDir, "SKILL.md"), `${header}# ${slug}\n`, "utf8");
}

function buildApp() {
  const app = new OpenAPIHono();
  registerSkillhubRoutes(app as Parameters<typeof registerSkillhubRoutes>[0]);
  return app;
}

describe("SkillHub Routes", () => {
  const app = buildApp();
  let tempRoot: string;
  let cacheDir: string;
  let curatedDir: string;
  let managedDir: string;

  beforeEach(() => {
    tempRoot = makeTempDir();
    cacheDir = resolve(tempRoot, "cache");
    curatedDir = resolve(tempRoot, "curated");
    managedDir = resolve(tempRoot, "managed");

    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(curatedDir, { recursive: true });
    mkdirSync(managedDir, { recursive: true });

    process.env.SKILLHUB_CACHE_DIR = cacheDir;
    process.env.OPENCLAW_CURATED_SKILLS_DIR = curatedDir;
    process.env.OPENCLAW_SKILLS_DIR = managedDir;

    writeFileSync(resolve(cacheDir, "catalog.json"), "[]\n", "utf8");
    writeFileSync(
      resolve(cacheDir, "meta.json"),
      JSON.stringify(
        {
          version: "test-version",
          updatedAt: new Date().toISOString(),
          skillCount: 0,
        },
        null,
        2,
      ),
      "utf8",
    );
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
    process.env.SKILLHUB_CACHE_DIR = undefined;
    process.env.OPENCLAW_CURATED_SKILLS_DIR = undefined;
    process.env.OPENCLAW_SKILLS_DIR = undefined;
  });

  it("returns installed skill metadata in the catalog response", async () => {
    writeSkill(curatedDir, "weather", {
      name: "Weather",
      description: "Get the forecast.",
    });

    const res = await app.request("/api/v1/skillhub/catalog");

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      installedSkills: Array<{
        slug: string;
        source: string;
        name: string;
        description: string;
      }>;
    };

    expect(body.installedSkills).toContainEqual({
      slug: "weather",
      source: "curated",
      name: "Weather",
      description: "Get the forecast.",
    });
  });

  it("only removes the winning managed override when both sources exist", async () => {
    writeSkill(curatedDir, "weather", {
      name: "Curated Weather",
      description: "Bundled fallback",
    });
    writeSkill(managedDir, "weather", {
      name: "Managed Weather",
      description: "User-installed override",
    });

    const res = await app.request("/api/v1/skillhub/uninstall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "weather" }),
    });

    expect(res.status).toBe(200);
    expect(existsSync(resolve(managedDir, "weather"))).toBe(false);
    expect(existsSync(resolve(curatedDir, "weather"))).toBe(true);
    expect(existsSync(resolve(curatedDir, ".curated-state.json"))).toBe(false);
  });

  it("persists curated removals when uninstalling the curated winner", async () => {
    writeSkill(curatedDir, "github", {
      name: "GitHub",
      description: "Curated GitHub skill",
    });
    writeFileSync(
      resolve(curatedDir, ".curated-state.json"),
      JSON.stringify({ removedByUser: [], lastInstalledVersion: [] }, null, 2),
      "utf8",
    );

    const res = await app.request("/api/v1/skillhub/uninstall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "github" }),
    });

    expect(res.status).toBe(200);
    expect(existsSync(resolve(curatedDir, "github"))).toBe(false);

    const state = JSON.parse(
      readFileSync(resolve(curatedDir, ".curated-state.json"), "utf8"),
    ) as {
      removedByUser: string[];
      lastInstalledVersion: string[];
    };
    expect(state.removedByUser).toContain("github");
  });
});
