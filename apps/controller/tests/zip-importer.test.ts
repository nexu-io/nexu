import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const zipImporterMocks = vi.hoisted(() => {
  return {
    execFileSync: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({
  execFileSync: zipImporterMocks.execFileSync,
}));

import { importSkillZip } from "../src/services/skillhub/zip-importer.js";

describe("zip-importer", () => {
  let rootDir = "";
  let skillsDir = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-zip-importer-"));
    skillsDir = path.join(rootDir, "skills");
    zipImporterMocks.execFileSync.mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(rootDir, { recursive: true, force: true });
  });

  it("rejects zip-slip entries before extraction", () => {
    zipImporterMocks.execFileSync.mockImplementation(
      (file: string, args?: readonly string[]) => {
        if (file === "unzip" && args?.[0] === "-Z1") {
          return "../outside.txt\nsummarize/SKILL.md\n";
        }

        throw new Error(`unexpected command: ${file} ${args?.join(" ") ?? ""}`);
      },
    );

    const result = importSkillZip(Buffer.from("fake-zip"), skillsDir);

    expect(result).toEqual({
      ok: false,
      error: "Zip contains unsafe paths",
    });
    expect(zipImporterMocks.execFileSync).toHaveBeenCalledTimes(1);
    expect(zipImporterMocks.execFileSync).toHaveBeenCalledWith(
      "unzip",
      ["-Z1", expect.stringContaining("upload.zip")],
      expect.any(Object),
    );
  });

  it("rejects absolute-path entries before extraction", () => {
    zipImporterMocks.execFileSync.mockImplementation(
      (file: string, args?: readonly string[]) => {
        if (file === "unzip" && args?.[0] === "-Z1") {
          return "/tmp/payload\nsummarize/SKILL.md\n";
        }

        throw new Error(`unexpected command: ${file} ${args?.join(" ") ?? ""}`);
      },
    );

    const result = importSkillZip(Buffer.from("fake-zip"), skillsDir);

    expect(result).toEqual({
      ok: false,
      error: "Zip contains unsafe paths",
    });
    expect(zipImporterMocks.execFileSync).toHaveBeenCalledTimes(1);
  });
});
