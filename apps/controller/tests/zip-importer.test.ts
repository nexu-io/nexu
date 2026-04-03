import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importSkillZip } from "../src/services/skillhub/zip-importer.js";

/**
 * Build a minimal ZIP buffer containing the given entries.
 * Each entry is { name: string; content?: string }.
 * Directory entries end with "/".
 *
 * This hand-rolls a valid ZIP file (local file headers + central directory +
 * end-of-central-directory record) so we don't need a dev dependency on yazl.
 */
function buildZipBuffer(
  entries: Array<{ name: string; content?: string }>,
): Buffer {
  const localHeaders: Buffer[] = [];
  const centralHeaders: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const contentBuffer = entry.content
      ? Buffer.from(entry.content, "utf8")
      : Buffer.alloc(0);

    // Local file header (30 bytes + name + content)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(0, 8); // compression (stored)
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(0, 14); // crc32 (0 for simplicity)
    localHeader.writeUInt32LE(contentBuffer.length, 18); // compressed size
    localHeader.writeUInt32LE(contentBuffer.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // name length
    localHeader.writeUInt16LE(0, 28); // extra field length
    nameBuffer.copy(localHeader, 30);

    const localEntry = Buffer.concat([localHeader, contentBuffer]);
    localHeaders.push(localEntry);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // compression
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0, 14); // mod date
    centralHeader.writeUInt32LE(0, 16); // crc32
    centralHeader.writeUInt32LE(contentBuffer.length, 20); // compressed size
    centralHeader.writeUInt32LE(contentBuffer.length, 24); // uncompressed size
    centralHeader.writeUInt16LE(nameBuffer.length, 28); // name length
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset
    nameBuffer.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);
    offset += localEntry.length;
  }

  const centralDirBuffer = Buffer.concat(centralHeaders);
  const centralDirOffset = offset;

  // End of central directory record (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central dir disk
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralDirBuffer.length, 12); // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localHeaders, centralDirBuffer, eocd]);
}

describe("zip-importer", () => {
  let rootDir = "";
  let skillsDir = "";

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "nexu-zip-importer-"));
    skillsDir = path.join(rootDir, "skills");
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it("rejects zip-slip entries before extraction", async () => {
    const zipBuffer = buildZipBuffer([
      { name: "../outside.txt", content: "escaped" },
      { name: "summarize/SKILL.md", content: "# Summarize" },
    ]);

    const result = await importSkillZip(zipBuffer, skillsDir);

    expect(result).toEqual({
      ok: false,
      error: "Zip contains unsafe paths",
    });
  });

  it("rejects absolute-path entries before extraction", async () => {
    const zipBuffer = buildZipBuffer([
      { name: "/tmp/payload", content: "payload" },
      { name: "summarize/SKILL.md", content: "# Summarize" },
    ]);

    const result = await importSkillZip(zipBuffer, skillsDir);

    expect(result).toEqual({
      ok: false,
      error: "Zip contains unsafe paths",
    });
  });

  it("imports a valid skill zip with subdirectory", async () => {
    const zipBuffer = buildZipBuffer([
      { name: "my-skill/", content: "" },
      { name: "my-skill/SKILL.md", content: "# My Skill" },
      { name: "my-skill/index.ts", content: "export default {};" },
    ]);

    const result = await importSkillZip(zipBuffer, skillsDir);

    expect(result.ok).toBe(true);
    expect(result.slug).toBe("my-skill");
  });

  it("rejects zip without SKILL.md", async () => {
    const zipBuffer = buildZipBuffer([
      { name: "my-skill/", content: "" },
      { name: "my-skill/index.ts", content: "export default {};" },
    ]);

    const result = await importSkillZip(zipBuffer, skillsDir);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Zip must contain a SKILL.md at its root");
  });

  it("rejects zip exceeding max size", async () => {
    const oversized = Buffer.alloc(51 * 1024 * 1024);

    const result = await importSkillZip(oversized, skillsDir);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("too large");
  });
});
