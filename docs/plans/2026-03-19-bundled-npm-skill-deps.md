# Bundled npm for Skill Dependencies — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix `installSkillDeps()` to use a bundled npm binary resolved via `require.resolve()` instead of relying on the user's PATH, so skill dependency installation works in the packaged Electron app.

**Architecture:** Add `npm` as a production dependency of `@nexu/desktop`. Resolve `npm/bin/npm-cli.js` via the existing `nodeRequire` (same pattern as `resolveClawHubBin`). Run it with `process.execPath` + `ELECTRON_RUN_AS_NODE=1`. This eliminates PATH dependency while keeping the parallel install structure intact.

**Tech Stack:** npm (as bundled dep), Electron `process.execPath`, `createRequire`, `execFileAsync`

---

### Task 1: Add npm as a production dependency

**Files:**
- Modify: `apps/desktop/package.json:24-49`

**Step 1: Add npm dependency**

In `apps/desktop/package.json`, add `"npm": "^11"` to the `dependencies` object (alphabetically between `"lucide-react"` and `"pg"`).

**Step 2: Install**

Run: `pnpm install`
Expected: npm package added to desktop node_modules

**Step 3: Verify npm-cli.js is resolvable**

Run: `node -e "const {createRequire}=require('module'); const r=createRequire(require('path').resolve('apps/desktop/package.json')); console.log(r.resolve('npm/bin/npm-cli.js'))"`
Expected: prints a valid path to `npm-cli.js`

---

### Task 2: Add resolveNpmBin() helper function

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts:37-44`

**Step 1: Add helper after resolveClawHubBin()**

Add a `resolveNpmBin()` function that uses the same `nodeRequire` pattern:

```typescript
function resolveNpmBin(): string {
  return nodeRequire.resolve("npm/bin/npm-cli.js");
}
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

---

### Task 3: Fix installSkillDeps() to use bundled npm

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts:363-384`

**Step 1: Replace the inline execSync approach with bundled npm-cli.js**

Replace the current `installSkillDeps()` body. Instead of running an inline script that calls `execSync("npm install --production")` (which relies on PATH), use `execFileAsync` with `process.execPath` pointing at the bundled `npm-cli.js`:

```typescript
private async installSkillDeps(
  skillDir: string,
  slug: string,
): Promise<void> {
  if (!existsSync(resolve(skillDir, "package.json"))) return;

  this.log("info", `installing npm deps: ${slug}`);
  try {
    const npmBin = resolveNpmBin();
    await execFileAsync(
      process.execPath,
      [npmBin, "install", "--production", "--no-audit", "--no-fund"],
      {
        cwd: skillDir,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      },
    );
    this.log("info", `npm deps installed: ${slug}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    this.log("warn", `npm deps failed for ${slug}: ${message}`);
  }
}
```

Key differences from old version:
- Uses `resolveNpmBin()` — no PATH dependency
- Uses `cwd: skillDir` — cleaner than `process.chdir()` in inline script
- Adds `--no-audit --no-fund` — skip noise, faster install
- Uses `execFileAsync` directly — not wrapped in `execSync` inside `-e` eval

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run lint + format**

Run: `pnpm format && pnpm lint`
Expected: PASS

---

### Task 4: Build and verify with start

**Step 1: Start desktop**

Run: `pnpm start`

**Step 2: Check logs for npm dep installation**

Run: `cat "$HOME/Library/Application Support/@nexu/desktop/logs/desktop-main.log" | grep -i "npm deps"`
Expected: Lines like `installing npm deps: imap-smtp-email` and `npm deps installed: imap-smtp-email`

**Step 3: Verify node_modules exists in skill directory**

Run: `ls "$HOME/Library/Application Support/@nexu/desktop/runtime/openclaw/state/bundled-skills/imap-smtp-email/node_modules/" | head -5`
Expected: directories like `imap/`, `nodemailer/`, etc.

**Step 4: Stop desktop**

Run: `pnpm stop`

---

## Summary

| Before | After |
|--------|-------|
| `execSync("npm install --production")` via inline `-e` eval | `execFileAsync(process.execPath, [npmBin, "install", ...])` |
| Relies on `npm` being on user's PATH | Resolves bundled `npm/bin/npm-cli.js` via `require.resolve` |
| Fails silently in packaged app | Works in both dev and packaged app |
| Cost: 0 bytes added | Cost: ~2.5MB compressed (negligible for Electron) |
