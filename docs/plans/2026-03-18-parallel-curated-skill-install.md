# Parallel Curated Skill Install

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce curated skill installation time from ~30s (16 sequential `clawhub install` child processes) to ~3-5s using parallel downloads with the clawhub programmatic API.

**Architecture:** Replace the sequential `for...of` + `execFileAsync(process.execPath, [clawHubBin, ...])` loop with parallel `Promise.allSettled` batches calling clawhub's JS API directly (`downloadZip` + `extractZipToDir`). This eliminates child process overhead (16 process spawns) and enables concurrent network I/O. npm dep installs also run in parallel after all downloads complete.

**Tech Stack:** clawhub JS API (`downloadZip`, `extractZipToDir`, `writeSkillOrigin`, `readLockfile`, `writeLockfile`), `Promise.allSettled`, existing `execFileAsync` for npm deps.

---

## Bottleneck Analysis

Current `installCuratedSkills()` installs 16 skills sequentially:
1. Each iteration spawns a child process (`process.execPath` + clawhub CLI) — ~150ms overhead per spawn
2. Each process does: resolve registry → fetch metadata → download zip → extract → write lockfile — **all sequential**
3. After each install, `installSkillDeps()` runs `npm install` — also sequential
4. `resolveClawHubBin()` is called inside the loop, re-reading `package.json` 16 times

**Estimated current time:** 16 × (150ms spawn + 800ms network + 200ms extract + npm) ≈ 20-40s

**Target time:** Parallel downloads with concurrency=5, single lockfile write at end ≈ 3-5s

---

### Task 1: Add a private `installSingleSkillDirect()` method

This method uses clawhub's JS API directly instead of spawning a CLI process.

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts`

**Step 1: Write the failing test**

No unit test needed — this is a private method on CatalogManager and the existing `installCuratedSkills` integration behavior is unchanged. We'll verify via typecheck + manual test.

**Step 2: Add clawhub JS API imports at the top of catalog-manager.ts**

After the existing `const nodeRequire = createRequire(import.meta.url);` line (~line 35), add:

```typescript
// clawhub programmatic API — avoids child process overhead
const clawHubMod = {
  downloadZip: null as null | typeof import("clawhub/dist/http.js").downloadZip,
  extractZipToDir: null as null | typeof import("clawhub/dist/skills.js").extractZipToDir,
  writeSkillOrigin: null as null | typeof import("clawhub/dist/skills.js").writeSkillOrigin,
  readLockfile: null as null | typeof import("clawhub/dist/skills.js").readLockfile,
  writeLockfile: null as null | typeof import("clawhub/dist/skills.js").writeLockfile,
};
```

**Wait — clawhub is ESM.** Since catalog-manager.ts compiles to ESM via Vite, we can use dynamic `import()`. Better approach: lazy-load at call time.

Actually, looking at the Vite build output, this is bundled. The cleanest approach is to use dynamic import inside the method.

**Step 2 (revised): Add private method `installSingleSkillDirect()`**

Add this private method to CatalogManager, before `installSkillDeps()`:

```typescript
private async installSingleSkillDirect(
  slug: string,
  targetDir: string,
): Promise<void> {
  const { downloadZip, extractZipToDir } = await import("clawhub/dist/skills.js")
    .catch(() => import("clawhub"));
  const { downloadZip: dlZip } = await import("clawhub/dist/http.js")
    .catch(() => ({ downloadZip: undefined }));

  // ... see Task 2 for full implementation
}
```

**Problem:** clawhub's internal module paths may not be stable or re-exported. Safer to keep using the CLI but run them in parallel.

---

## Revised approach: Parallel CLI invocations (simpler, safer)

Instead of switching to clawhub's internal JS API (which has import path stability concerns), we keep the existing `execFileAsync` CLI approach but run installs **concurrently** with a concurrency limiter.

This is simpler, requires fewer changes, and still gives us 3-5x speedup.

---

### Task 1: Hoist `resolveClawHubBin()` call outside the loop

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts:288-316`

**Step 1: In `installCuratedSkills()`, move `resolveClawHubBin()` before the loop**

Current code resolves the bin path inside the `for` loop (line 290). Move it before the loop:

```typescript
// BEFORE the loop (around line 287)
const clawHubBin = resolveClawHubBin();

// INSIDE the loop — remove the per-iteration call
// DELETE: const clawHubBin = resolveClawHubBin();
```

**Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/main/skillhub/catalog-manager.ts
git commit -m "perf(desktop): hoist resolveClawHubBin outside curated install loop"
```

---

### Task 2: Parallelize curated skill installs with concurrency limit

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts:255-327`

**Step 1: Replace the sequential loop with parallel batches**

Replace the entire `for (const slug of toInstall) { ... }` block with:

```typescript
const CONCURRENCY = 5;
const clawHubBin = resolveClawHubBin();

const installOne = async (slug: string): Promise<{ slug: string; ok: boolean }> => {
  try {
    this.log("info", `curated installing: ${slug} -> ${this.curatedSkillsDir}`);
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        clawHubBin,
        "--workdir",
        this.curatedSkillsDir,
        "--dir",
        ".",
        "install",
        slug,
        "--force",
      ],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
    );
    if (stdout) this.log("info", `curated stdout: ${stdout.trim()}`);
    if (stderr) this.log("warn", `curated stderr: ${stderr.trim()}`);
    this.log("info", `curated install ok: ${slug}`);
    return { slug, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    this.log("error", `curated install failed: ${slug} — ${message}`);
    return { slug, ok: false };
  }
};

// Install in parallel batches of CONCURRENCY
const installed: string[] = [];
const failed: string[] = [];

for (let i = 0; i < toInstall.length; i += CONCURRENCY) {
  const batch = toInstall.slice(i, i + CONCURRENCY);
  const results = await Promise.allSettled(batch.map(installOne));
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.ok) {
      installed.push(result.value.slug);
    } else if (result.status === "fulfilled") {
      failed.push(result.value.slug);
    } else {
      // Promise rejected (shouldn't happen since installOne catches)
      failed.push("unknown");
    }
  }
}
```

**Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

**Step 3: Run lint + format**

```bash
pnpm format && pnpm lint
```

Expected: PASS

---

### Task 3: Parallelize npm dep installs after all skill downloads

**Files:**
- Modify: `apps/desktop/main/skillhub/catalog-manager.ts`

**Step 1: Move `installSkillDeps` calls to after all clawhub installs complete**

After the parallel install loop and before `recordCuratedInstallation`, add:

```typescript
// Install npm deps in parallel for skills that have package.json
if (installed.length > 0) {
  const depResults = await Promise.allSettled(
    installed.map((slug) =>
      this.installSkillDeps(resolve(this.curatedSkillsDir, slug), slug),
    ),
  );
  for (const r of depResults) {
    if (r.status === "rejected") {
      this.log("warn", `npm dep install rejected: ${r.reason}`);
    }
  }
}
```

Remove the per-skill `installSkillDeps` call from inside the install loop (currently at line 313).

**Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

**Step 3: Commit**

```bash
git add apps/desktop/main/skillhub/catalog-manager.ts
git commit -m "perf(desktop): parallelize curated skill install and npm deps"
```

---

### Task 4: Verify end-to-end

**Step 1: Clean curated state to force reinstall**

```bash
# Find and delete curated state to trigger fresh install
rm -rf "$HOME/Library/Application Support/@nexu/desktop/runtime/openclaw/state/bundled-skills/"
rm -f "$HOME/Library/Application Support/@nexu/desktop/runtime/openclaw/state/bundled-skills/.curated-state.json"
```

**Step 2: Build and launch desktop**

```bash
pnpm desktop:dist:mac:unsigned
```

Open the DMG and launch Nexu.app.

**Step 3: Check logs for parallel install behavior**

Look for interleaved "curated installing:" log lines (proof of parallelism) and timing.

```bash
# Check desktop main log
cat "$HOME/Library/Application Support/@nexu/desktop/logs/desktop-main.log" | grep -i curated
```

Expected: Multiple "curated installing:" lines appearing with close timestamps, followed by "curated install ok:" lines, then "installing npm deps:" lines.

**Step 4: Verify skills are present**

```bash
ls "$HOME/Library/Application Support/@nexu/desktop/runtime/openclaw/state/bundled-skills/"
```

Expected: All 16 curated skill directories present with SKILL.md files, plus `imap-smtp-email/node_modules/` populated.

---

## Summary of changes

| Change | Impact |
|--------|--------|
| Hoist `resolveClawHubBin()` outside loop | Eliminates 15 redundant `package.json` reads |
| `Promise.allSettled` with concurrency=5 | 5 parallel downloads instead of 16 sequential |
| Batch npm deps after downloads | npm installs run in parallel, not blocking downloads |

**Expected improvement:** 16 sequential installs (~2s each) → 4 batches of 5 parallel (~2s each) = ~8s total → ~3-5x faster.
