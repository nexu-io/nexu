# Verify Newly Curated Skills Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Verify the 4 newly added curated skills (`baoyu-xhs-images`, `deep-research`, `research-to-diagram`, `qiaomu-mondo-poster-design`) can be installed from ClawHub and loaded by the controller.

**Architecture:** Start the controller, trigger curated skill install, verify each skill lands on disk with a valid SKILL.md, appears in the API catalog response, and is recorded in the lowdb ledger.

**Tech Stack:** Controller (Hono), clawhub CLI, lowdb (skill-ledger.json), Vitest

---

## Pre-requisites

- `pnpm install` completed
- Network access (ClawHub registry)
- Controller env configured (`apps/controller/.env`)
- No existing installs of the 4 new skills in `~/.nexu/runtime/openclaw/state/skills/`

## Key Paths

| Component | Path |
|-----------|------|
| Curated list | `apps/controller/src/services/skillhub/curated-skills.ts` |
| Catalog manager | `apps/controller/src/services/skillhub/catalog-manager.ts` |
| Skill DB ledger | `~/.nexu/skill-ledger.json` |
| Skills dir | `~/.nexu/runtime/openclaw/state/skills/{slug}/` |
| API routes | `apps/controller/src/routes/skillhub-routes.ts` |
| Existing tests | `apps/controller/tests/skillhub-service.test.ts` |

---

### Task 1: Validate slugs exist on ClawHub

Before anything else, confirm the 4 bare slugs resolve on ClawHub. If a slug doesn't resolve, the install will silently fail.

**Step 1: Test each slug with clawhub CLI dry-run**

```bash
cd /Users/alche/Documents/digit-sutando/nexu
SKILLS_DIR=$(mktemp -d)

for slug in baoyu-xhs-images deep-research research-to-diagram qiaomu-mondo-poster-design; do
  echo "--- Testing: $slug ---"
  node $(node -e "console.log(require.resolve('clawhub/package.json').replace('package.json','bin/clawhub.js'))") \
    --workdir "$SKILLS_DIR" --dir . install "$slug" --force 2>&1
  if [ -f "$SKILLS_DIR/$slug/SKILL.md" ]; then
    echo "OK: $slug installed, SKILL.md found"
  else
    echo "FAIL: $slug — no SKILL.md"
  fi
done

rm -rf "$SKILLS_DIR"
```

Expected: All 4 print `OK: <slug> installed, SKILL.md found`.

**If a slug fails:** The slug may need an author prefix on ClawHub but our `isValidSlug` regex rejects slashes. Check ClawHub registry for the correct bare slug name and update `curated-skills.ts`.

**Step 2: Record results**

Note which slugs succeeded and which failed. Only proceed with passing slugs.

---

### Task 2: Write integration test for new curated slugs

**Files:**
- Create: `apps/controller/tests/curated-skills-slugs.test.ts`
- Reference: `apps/controller/src/services/skillhub/curated-skills.ts`

**Step 1: Write the test**

```typescript
import { describe, expect, it } from "vitest";
import { CURATED_SKILL_SLUGS } from "../src/services/skillhub/curated-skills.js";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,127}$/;

describe("curated skill slugs", () => {
  it("all slugs pass validation regex", () => {
    for (const slug of CURATED_SKILL_SLUGS) {
      expect(slug).toMatch(SLUG_REGEX);
    }
  });

  it("no duplicate slugs", () => {
    const unique = new Set(CURATED_SKILL_SLUGS);
    expect(unique.size).toBe(CURATED_SKILL_SLUGS.length);
  });

  it("includes newly added skills", () => {
    const newSlugs = [
      "baoyu-xhs-images",
      "deep-research",
      "research-to-diagram",
      "qiaomu-mondo-poster-design",
    ];
    for (const slug of newSlugs) {
      expect(CURATED_SKILL_SLUGS).toContain(slug);
    }
  });
});
```

**Step 2: Run the test**

```bash
pnpm --filter @nexu/controller test -- curated-skills-slugs
```

Expected: All 3 tests PASS.

**Step 3: Commit**

```bash
git add apps/controller/tests/curated-skills-slugs.test.ts
git commit -m "test: add curated skill slug validation tests"
```

---

### Task 3: Verify install via controller API

Start the controller and use the install endpoint to install each new skill.

**Step 1: Start the controller**

```bash
pnpm dev:controller
```

Wait for startup log: `controller listening on port ...`

**Step 2: Install each skill via API**

```bash
CONTROLLER_URL="http://localhost:3001"

for slug in baoyu-xhs-images deep-research research-to-diagram qiaomu-mondo-poster-design; do
  echo "--- Installing: $slug ---"
  curl -s -X POST "$CONTROLLER_URL/api/v1/skillhub/install" \
    -H "Content-Type: application/json" \
    -d "{\"slug\": \"$slug\"}" | node -e "
      let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
        const r=JSON.parse(d);
        console.log(r.ok ? 'OK' : 'FAIL: '+r.error);
      })"
done
```

Expected: All 4 print `OK`.

**Step 3: Verify via catalog endpoint**

```bash
curl -s "$CONTROLLER_URL/api/v1/skillhub/catalog" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    const catalog = JSON.parse(d);
    const target = ['baoyu-xhs-images','deep-research','research-to-diagram','qiaomu-mondo-poster-design'];
    for (const slug of target) {
      const installed = catalog.installedSlugs.includes(slug);
      const detail = catalog.installedSkills.find(s => s.slug === slug);
      console.log(slug + ': ' + (installed ? 'INSTALLED' : 'MISSING') +
        (detail ? ' name=\"' + detail.name + '\"' : ' (no detail)'));
    }
  })"
```

Expected: All 4 show `INSTALLED` with a parsed name from SKILL.md.

---

### Task 4: Verify on-disk structure

**Step 1: Check SKILL.md exists for each skill**

```bash
SKILLS_DIR="$HOME/.nexu/runtime/openclaw/state/skills"

for slug in baoyu-xhs-images deep-research research-to-diagram qiaomu-mondo-poster-design; do
  if [ -f "$SKILLS_DIR/$slug/SKILL.md" ]; then
    echo "OK: $slug/SKILL.md exists"
    head -5 "$SKILLS_DIR/$slug/SKILL.md"
  else
    echo "FAIL: $slug/SKILL.md missing"
  fi
  echo "---"
done
```

Expected: All 4 have SKILL.md with valid YAML frontmatter.

**Step 2: Check skill-ledger.json**

```bash
cat ~/.nexu/skill-ledger.json | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    const db = JSON.parse(d);
    const target = ['baoyu-xhs-images','deep-research','research-to-diagram','qiaomu-mondo-poster-design'];
    for (const slug of target) {
      const rec = db.skills.find(s => s.slug === slug);
      if (rec) {
        console.log(slug + ': status=' + rec.status + ' source=' + rec.source);
      } else {
        console.log(slug + ': NOT IN LEDGER');
      }
    }
  })"
```

Expected: All 4 show `status=installed source=curated` (or `source=managed` if installed via API).

---

### Task 5: Verify skill content is usable

Check that each skill has the expected structure (references, scripts, etc.) and no broken dependencies.

**Step 1: Check deep-research (prompt-only)**

```bash
SKILLS_DIR="$HOME/.nexu/runtime/openclaw/state/skills"
echo "=== deep-research ==="
ls "$SKILLS_DIR/deep-research/"
echo "--- frontmatter ---"
head -10 "$SKILLS_DIR/deep-research/SKILL.md"
```

Expected: SKILL.md present, no scripts required.

**Step 2: Check research-to-diagram (needs Graphviz)**

```bash
echo "=== research-to-diagram ==="
ls "$SKILLS_DIR/research-to-diagram/"
echo "--- graphviz check ---"
which dot && echo "Graphviz: AVAILABLE" || echo "Graphviz: NOT INSTALLED (skill will warn at runtime)"
```

Expected: SKILL.md present. Graphviz may or may not be installed — this is a known optional dependency.

**Step 3: Check qiaomu-mondo-poster-design (has Python scripts)**

```bash
echo "=== qiaomu-mondo-poster-design ==="
ls "$SKILLS_DIR/qiaomu-mondo-poster-design/"
ls "$SKILLS_DIR/qiaomu-mondo-poster-design/scripts/" 2>/dev/null || echo "No scripts dir"
cat "$SKILLS_DIR/qiaomu-mondo-poster-design/requirements.txt" 2>/dev/null || echo "No requirements.txt"
```

Expected: SKILL.md present. Python scripts and requirements.txt may exist but are optional — the prompt/reference part works without them.

**Step 4: Check baoyu-xhs-images (prompt + references)**

```bash
echo "=== baoyu-xhs-images ==="
ls "$SKILLS_DIR/baoyu-xhs-images/"
ls "$SKILLS_DIR/baoyu-xhs-images/references/" 2>/dev/null || echo "No references dir"
```

Expected: SKILL.md + references/ directory with style presets and workflow docs.

---

### Task 6: Uninstall and re-install round-trip

Verify the uninstall/reinstall cycle works and the ledger tracks state correctly.

**Step 1: Uninstall one skill**

```bash
curl -s -X POST "$CONTROLLER_URL/api/v1/skillhub/uninstall" \
  -H "Content-Type: application/json" \
  -d '{"slug": "deep-research"}' | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d)))"
```

Expected: `{ ok: true }`

**Step 2: Verify removed from disk and ledger**

```bash
ls "$HOME/.nexu/runtime/openclaw/state/skills/deep-research/SKILL.md" 2>/dev/null && echo "STILL ON DISK" || echo "OK: removed from disk"

cat ~/.nexu/skill-ledger.json | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    const rec = JSON.parse(d).skills.find(s=>s.slug==='deep-research');
    console.log('ledger:', rec ? rec.status : 'not found');
  })"
```

Expected: Removed from disk, ledger shows `status=uninstalled`.

**Step 3: Re-install**

```bash
curl -s -X POST "$CONTROLLER_URL/api/v1/skillhub/install" \
  -H "Content-Type: application/json" \
  -d '{"slug": "deep-research"}' | node -e "
    let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d)))"
```

Expected: `{ ok: true }`, SKILL.md back on disk, ledger shows `status=installed`.

---

## Success Criteria

| Check | Expected |
|-------|----------|
| All 4 slugs pass `isValidSlug` regex | PASS |
| All 4 install via clawhub CLI | PASS |
| All 4 appear in `GET /api/v1/skillhub/catalog` installedSlugs | PASS |
| All 4 have SKILL.md on disk | PASS |
| All 4 recorded in skill-ledger.json | PASS |
| Uninstall/reinstall round-trip works | PASS |
| Unit tests pass | PASS |

## Known Limitations

- `qiaomu-mondo-poster-design` Python scripts won't auto-install deps (no pip support in pipeline)
- `research-to-diagram` needs Graphviz installed by user for diagram generation
- These are cosmetic — the skills install and load, just some features degrade gracefully
