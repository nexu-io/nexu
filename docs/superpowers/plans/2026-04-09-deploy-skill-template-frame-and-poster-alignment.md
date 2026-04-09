# Deploy Skill Template Frame And Poster Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the new canonical `distill-campaign` content frame in the bundled `deploy-skill` and align the poster typography/layout to the provided fixed CSS spec.

**Architecture:** Tighten the template boundary in `deploy_skill_core.js` so invalid payloads fail before rendering, then adjust the poster HTML/CSS to use the fixed dimensions, font settings, and positioned text blocks from the spec. Keep the rest of the page behavior unchanged and verify everything through the existing focused skill test file.

**Tech Stack:** Node.js, bundled Nexu desktop skill, Vitest, JSZip, static HTML/CSS template rendering

---

## File Structure

- Modify: `apps/desktop/static/bundled-skills/deploy-skill/scripts/deploy_skill_core.js`
  - tighten `parseTemplateContent()` validation
  - remove fallback poster-species defaults
  - align poster HTML text blocks and mappings
- Modify: `apps/desktop/static/bundled-skills/deploy-skill/templates/distill-campaign/styles.css`
  - apply fixed poster typography and positioning from the provided CSS
- Modify: `apps/desktop/static/bundled-skills/deploy-skill/SKILL.md`
  - document the strict frame contract
- Modify: `tests/skills/deploy-skill-core.test.ts`
  - add failing validation tests first
  - add poster HTML/CSS assertions for aligned text formatting

### Task 1: Lock The Canonical Frame In Tests

**Files:**
- Modify: `tests/skills/deploy-skill-core.test.ts`
- Test: `tests/skills/deploy-skill-core.test.ts`

- [ ] **Step 1: Write the failing validation tests**

Add these test cases to `tests/skills/deploy-skill-core.test.ts` inside the existing `"deploy skill core"` suite:

```ts
  it("rejects a title outside the 2-10 character limit", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const contentPath = path.join(rootDir, "bad-title.json");
    await writeLocalNexuConfig();
    await savePageDeployConfig(rootDir, { baseUrl: "https://deploy.example.com" });
    await writeFile(
      contentPath,
      JSON.stringify({
        title: "A",
        subtitle: "牛马指数 92/100 — 龙虾成瘾者",
        tags: ["nexu", "增长产品", "Co-builder", "ENTJ"],
        metrics: [
          { label: "🐂🐴 牛马指数", value: "92" },
          { label: "⚡ 热点追击力", value: "95%" },
          { label: "🧠 信息密度", value: "88%" },
          { label: "📈 操盘手感", value: "90%" }
        ],
        posterSpeciesEmoji: "🦞",
        posterSpeciesName: "龙虾成瘾者",
        posterSpeciesSub: "办公室物种鉴定",
        description: "你是那种能把信息差、执行力和控制欲拧成一根钢缆的人。你看起来像在推进项目，实际上是在逼时间给你让路。你对热点的嗅觉过于灵敏，对机会的反应快到让同事怀疑你是不是提前收到了剧本。你最大的可怕之处不是卷，而是你卷得还很有方法。可你也不是没有裂缝，你只是太习惯在别人慌乱时继续往前走，忘了自己也会累。好在你心里仍然留着一点柔软，所以你不只是一个推进器，还是那个会把团队一起带上岸的人。",
        qaCards: [
          { question: "致命优势", answer: "你对节奏的判断极准，知道什么时候该抢，什么时候该守。你不会为了显得聪明而拖慢推进，反而总能在别人犹豫时先把路试出来。你的行动不是盲冲，而是把混乱快速压缩成可执行路径，这种能力很稀缺。" },
          { question: "人生建议", answer: "继续保持你的锋利，但别把所有事都扛成自己的责任。你真正厉害的地方，不只是能冲，还能让别人跟你一起冲。把部分控制欲换成更稳定的协作，你会更轻松，也会走得更远。" }
        ],
        dialogs: [
          { speaker: "bot", text: "你又在刷新热点榜单，准备下一轮出手了？" },
          { speaker: "user", text: "不是刷新，是提前埋伏。" },
          { speaker: "bot", text: "行，你还是那个把流量当氧气吸的人。" }
        ],
        ctaText: "⭐ 生成我的牛马锐评",
        installText: "复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill"
      }),
    );

    await expect(
      submitPageDeployTemplateJob(
        {
          nexuHome: rootDir,
          templateId: "distill-campaign",
          contentFile: contentPath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        { fetchImpl: vi.fn() },
      ),
    ).rejects.toThrow(/title/i);
  });

  it("rejects subtitle strings that do not match the required overall format", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const contentPath = path.join(rootDir, "bad-subtitle.json");
    await writeLocalNexuConfig();
    await savePageDeployConfig(rootDir, { baseUrl: "https://deploy.example.com" });
    await writeFile(
      contentPath,
      JSON.stringify({
        title: "李锦威",
        subtitle: "Founder / Product / Builder",
        tags: ["nexu", "增长产品", "Co-builder", "ENTJ"],
        metrics: [
          { label: "🐂🐴 牛马指数", value: "92" },
          { label: "⚡ 热点追击力", value: "95%" },
          { label: "🧠 信息密度", value: "88%" },
          { label: "📈 操盘手感", value: "90%" }
        ],
        posterSpeciesEmoji: "🦞",
        posterSpeciesName: "龙虾成瘾者",
        posterSpeciesSub: "办公室物种鉴定",
        description: "你是那种能把信息差、执行力和控制欲拧成一根钢缆的人。你看起来像在推进项目，实际上是在逼时间给你让路。你对热点的嗅觉过于灵敏，对机会的反应快到让同事怀疑你是不是提前收到了剧本。你最大的可怕之处不是卷，而是你卷得还很有方法。可你也不是没有裂缝，你只是太习惯在别人慌乱时继续往前走，忘了自己也会累。好在你心里仍然留着一点柔软，所以你不只是一个推进器，还是那个会把团队一起带上岸的人。",
        qaCards: [
          { question: "致命优势", answer: "你对节奏的判断极准，知道什么时候该抢，什么时候该守。你不会为了显得聪明而拖慢推进，反而总能在别人犹豫时先把路试出来。你的行动不是盲冲，而是把混乱快速压缩成可执行路径，这种能力很稀缺。" },
          { question: "人生建议", answer: "继续保持你的锋利，但别把所有事都扛成自己的责任。你真正厉害的地方，不只是能冲，还能让别人跟你一起冲。把部分控制欲换成更稳定的协作，你会更轻松，也会走得更远。" }
        ],
        dialogs: [
          { speaker: "bot", text: "你又在刷新热点榜单，准备下一轮出手了？" },
          { speaker: "user", text: "不是刷新，是提前埋伏。" },
          { speaker: "bot", text: "行，你还是那个把流量当氧气吸的人。" }
        ],
        ctaText: "⭐ 生成我的牛马锐评",
        installText: "复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill"
      }),
    );

    await expect(
      submitPageDeployTemplateJob(
        {
          nexuHome: rootDir,
          templateId: "distill-campaign",
          contentFile: contentPath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        { fetchImpl: vi.fn() },
      ),
    ).rejects.toThrow(/subtitle/i);
  });

  it("rejects metrics with a main score that includes percent notation", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const contentPath = path.join(rootDir, "bad-metrics.json");
    await writeLocalNexuConfig();
    await savePageDeployConfig(rootDir, { baseUrl: "https://deploy.example.com" });
    await writeFile(
      contentPath,
      JSON.stringify({
        title: "李锦威",
        subtitle: "牛马指数 92/100 — 龙虾成瘾者",
        tags: ["nexu", "增长产品", "Co-builder", "ENTJ"],
        metrics: [
          { label: "🐂🐴 牛马指数", value: "92%" },
          { label: "⚡ 热点追击力", value: "95%" },
          { label: "🧠 信息密度", value: "88%" },
          { label: "📈 操盘手感", value: "90%" }
        ],
        posterSpeciesEmoji: "🦞",
        posterSpeciesName: "龙虾成瘾者",
        posterSpeciesSub: "办公室物种鉴定",
        description: "你是那种能把信息差、执行力和控制欲拧成一根钢缆的人。你看起来像在推进项目，实际上是在逼时间给你让路。你对热点的嗅觉过于灵敏，对机会的反应快到让同事怀疑你是不是提前收到了剧本。你最大的可怕之处不是卷，而是你卷得还很有方法。可你也不是没有裂缝，你只是太习惯在别人慌乱时继续往前走，忘了自己也会累。好在你心里仍然留着一点柔软，所以你不只是一个推进器，还是那个会把团队一起带上岸的人。",
        qaCards: [
          { question: "致命优势", answer: "你对节奏的判断极准，知道什么时候该抢，什么时候该守。你不会为了显得聪明而拖慢推进，反而总能在别人犹豫时先把路试出来。你的行动不是盲冲，而是把混乱快速压缩成可执行路径，这种能力很稀缺。" },
          { question: "人生建议", answer: "继续保持你的锋利，但别把所有事都扛成自己的责任。你真正厉害的地方，不只是能冲，还能让别人跟你一起冲。把部分控制欲换成更稳定的协作，你会更轻松，也会走得更远。" }
        ],
        dialogs: [
          { speaker: "bot", text: "你又在刷新热点榜单，准备下一轮出手了？" },
          { speaker: "user", text: "不是刷新，是提前埋伏。" },
          { speaker: "bot", text: "行，你还是那个把流量当氧气吸的人。" }
        ],
        ctaText: "⭐ 生成我的牛马锐评",
        installText: "复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill"
      }),
    );

    await expect(
      submitPageDeployTemplateJob(
        {
          nexuHome: rootDir,
          templateId: "distill-campaign",
          contentFile: contentPath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        { fetchImpl: vi.fn() },
      ),
    ).rejects.toThrow(/metrics\[0\]\.value/i);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd /Users/alche/Documents/digit-sutando/nexu
pnpm exec vitest run tests/skills/deploy-skill-core.test.ts
```

Expected:
- FAIL in the new validation tests because the parser still accepts loose values.

- [ ] **Step 3: Add poster text-alignment assertions**

Extend the existing `"renders the distill-campaign template into a root-level zip before submit"` test with these assertions:

```ts
    expect(indexHtml).toContain('class="poster-title"');
    expect(indexHtml).toContain('class="poster-divider"');
    expect(indexHtml).toContain('class="poster-tags poster-tags-row poster-tags-row-1"');
    expect(indexHtml).toContain('class="poster-tags poster-tags-row poster-tags-row-2"');
    expect(indexHtml).toContain('class="poster-species-card"');
    expect(indexHtml).toContain('class="poster-score"');
    expect(indexHtml).toContain('class="poster-score-label"');

    expect(stylesCss).toContain('font-family: "Apple Braille", var(--sans);');
    expect(stylesCss).toContain('font-size: 77px;');
    expect(stylesCss).toContain('font-family: "PingFang SC", "Inter", sans-serif;');
    expect(stylesCss).toContain('font-size: 13px;');
    expect(stylesCss).toContain('font-family: "Archivo Black", "Inter", sans-serif;');
    expect(stylesCss).toContain('font-size: 123px;');
    expect(stylesCss).toContain('font-family: "Abhaya Libre", "Times New Roman", serif;');
    expect(stylesCss).toContain('font-size: 17px;');
```

- [ ] **Step 4: Run test to verify it fails**

Run:

```bash
cd /Users/alche/Documents/digit-sutando/nexu
pnpm exec vitest run tests/skills/deploy-skill-core.test.ts
```

Expected:
- FAIL if the current CSS still uses non-matching font-family declarations or missing text-layer selectors.

- [ ] **Step 5: Commit**

```bash
git -C /Users/alche/Documents/digit-sutando/nexu add tests/skills/deploy-skill-core.test.ts
git -C /Users/alche/Documents/digit-sutando/nexu commit -m "test: enforce deploy skill frame contract"
```

### Task 2: Tighten The Template Parser To Match The Canonical Frame

**Files:**
- Modify: `apps/desktop/static/bundled-skills/deploy-skill/scripts/deploy_skill_core.js`
- Test: `tests/skills/deploy-skill-core.test.ts`

- [ ] **Step 1: Write the failing parser expectations**

Use the failing tests from Task 1 as the red state. Do not change production code yet.

- [ ] **Step 2: Implement strict scalar and pattern validators**

Add these helpers near the existing validation helpers in `deploy_skill_core.js`:

```js
function assertStringLength(value, fieldName, min, max) {
  const normalized = assertNonEmptyString(value, fieldName);
  if (normalized.length < min || normalized.length > max) {
    throw new Error(
      `deploy-skill requires ${fieldName} with length ${min}-${max} characters.`,
    );
  }
  return normalized;
}

function assertNoRichText(value, fieldName, min, max) {
  const normalized = assertStringLength(value, fieldName, min, max);
  if (/[\r\n]/u.test(normalized)) {
    throw new Error(`deploy-skill template field ${fieldName} must not contain newlines.`);
  }
  if (/<[^>]+>/u.test(normalized)) {
    throw new Error(`deploy-skill template field ${fieldName} must not contain HTML.`);
  }
  if (/(\*\*|__|^- |\n- |\n\* )/u.test(normalized)) {
    throw new Error(`deploy-skill template field ${fieldName} must not contain markdown.`);
  }
  return normalized;
}

function assertExactValue(value, fieldName, expected) {
  const normalized = assertNonEmptyString(value, fieldName);
  if (normalized !== expected) {
    throw new Error(`deploy-skill template field ${fieldName} must equal "${expected}".`);
  }
  return normalized;
}

function assertSubtitleFormat(value) {
  const normalized = assertStringLength(value, "subtitle", 15, 30);
  if (
    !normalized.includes("牛马指数") ||
    !normalized.includes("/100") ||
    !normalized.includes("—")
  ) {
    throw new Error(
      "deploy-skill template field subtitle must include 牛马指数, /100, and —.",
    );
  }
  return normalized;
}
```

- [ ] **Step 3: Replace loose field parsing with strict frame validation**

Update `parseTemplateContent()` so the return object is built like this:

```js
  const title = assertStringLength(payload.title, "title", 2, 10);
  const subtitle = assertSubtitleFormat(payload.subtitle);
  const description = assertNoRichText(payload.description, "description", 150, 250);
  const ctaText = assertExactValue(
    payload.ctaText,
    "ctaText",
    "⭐ 生成我的牛马锐评",
  );
  const installText = assertExactValue(
    payload.installText,
    "installText",
    "复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill",
  );

  const tags = assertArrayLength(payload.tags, "tags", 1, 8).map((tag, index) =>
    assertStringLength(tag, `tags[${index}]`, 2, 8),
  );

  const metrics = assertArrayLength(payload.metrics, "metrics", 4, 6).map(
    (metric, index) => {
      if (typeof metric !== "object" || metric === null) {
        throw new Error(`deploy-skill template field metrics[${index}] is invalid.`);
      }
      const label =
        index === 0
          ? assertStringLength(metric.label, `metrics[${index}].label`, 6, 10)
          : assertStringLength(metric.label, `metrics[${index}].label`, 6, 12);
      const value = assertNonEmptyString(metric.value, `metrics[${index}].value`);
      if (index === 0) {
        if (!/^\d+$/u.test(value)) {
          throw new Error(
            "deploy-skill template field metrics[0].value must be a numeric string without %.",
          );
        }
      } else if (!/^\d+%$/u.test(value)) {
        throw new Error(
          `deploy-skill template field metrics[${index}].value must end with %.`,
        );
      }
      return { label, value };
    },
  );

  const qaCards = assertArrayLength(payload.qaCards, "qaCards", 2, 3).map(
    (card, index) => {
      if (typeof card !== "object" || card === null) {
        throw new Error(`deploy-skill template field qaCards[${index}] is invalid.`);
      }
      return {
        question: assertStringLength(card.question, `qaCards[${index}].question`, 3, 8),
        answer: assertNoRichText(card.answer, `qaCards[${index}].answer`, 80, 150),
      };
    },
  );

  const dialogs = assertArrayLength(payload.dialogs, "dialogs", 3, 6).map(
    (dialog, index) => {
      if (typeof dialog !== "object" || dialog === null) {
        throw new Error(`deploy-skill template field dialogs[${index}] is invalid.`);
      }
      const speaker = assertNonEmptyString(
        dialog.speaker,
        `dialogs[${index}].speaker`,
      ).toLowerCase();
      if (speaker !== "bot" && speaker !== "user") {
        throw new Error(
          `deploy-skill template field dialogs[${index}].speaker must be bot or user.`,
        );
      }
      return {
        speaker,
        text: assertNoRichText(dialog.text, `dialogs[${index}].text`, 15, 80),
      };
    },
  );

  return {
    title,
    subtitle,
    tags,
    metrics,
    description,
    qaCards,
    dialogs,
    ctaText,
    installText,
    posterSpeciesEmoji: assertStringLength(
      payload.posterSpeciesEmoji,
      "posterSpeciesEmoji",
      1,
      4,
    ),
    posterSpeciesName: assertStringLength(
      payload.posterSpeciesName,
      "posterSpeciesName",
      3,
      8,
    ),
    posterSpeciesSub: assertStringLength(
      payload.posterSpeciesSub,
      "posterSpeciesSub",
      5,
      8,
    ),
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd /Users/alche/Documents/digit-sutando/nexu
pnpm exec vitest run tests/skills/deploy-skill-core.test.ts
```

Expected:
- PASS for all frame-validation tests.

- [ ] **Step 5: Commit**

```bash
git -C /Users/alche/Documents/digit-sutando/nexu add apps/desktop/static/bundled-skills/deploy-skill/scripts/deploy_skill_core.js tests/skills/deploy-skill-core.test.ts
git -C /Users/alche/Documents/digit-sutando/nexu commit -m "feat: enforce deploy skill template frame"
```

### Task 3: Align Poster Typography And Text Geometry To The Provided CSS

**Files:**
- Modify: `apps/desktop/static/bundled-skills/deploy-skill/templates/distill-campaign/styles.css`
- Modify: `apps/desktop/static/bundled-skills/deploy-skill/scripts/deploy_skill_core.js`
- Test: `tests/skills/deploy-skill-core.test.ts`

- [ ] **Step 1: Use the failing poster-style assertions from Task 1**

Keep the red state from the CSS assertions before touching the poster typography code.

- [ ] **Step 2: Update poster title, tag, species, score, and footer styles**

Change the poster text rules in `styles.css` to match the provided spec:

```css
.poster-title {
  position: absolute;
  width: 179px;
  height: 100px;
  left: 208px;
  top: 105px;
  font-family: "Apple Braille", var(--sans);
  font-style: normal;
  font-weight: 400;
  font-size: 77px;
  line-height: 130%;
  display: flex;
  align-items: center;
  color: #ffffff;
}

.poster-divider {
  position: absolute;
  width: 413px;
  left: 219.5px;
  top: 202.5px;
  border-top: 1px solid #ffffff;
}

.poster-tag {
  width: 99px;
  height: 37px;
  padding: 10px 20px;
  border-radius: 85px;
  background: #ffffff;
  border: 0;
  color: #391934;
  font-family: "PingFang SC", "Inter", sans-serif;
  font-style: normal;
  font-weight: 600;
  font-size: 13px;
  line-height: 130%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.poster-species-name,
.poster-species-sub,
.poster-score-label {
  font-family: "Apple Braille", var(--sans);
  font-style: normal;
  font-weight: 400;
  line-height: 130%;
  background: linear-gradient(310.92deg, #222a15 26.58%, #7e3617 78.53%), #1e2513;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  color: transparent;
}

.poster-species-name {
  font-size: 29px;
}

.poster-species-sub {
  font-size: 29px;
}

.poster-score {
  font-family: "Archivo Black", "Inter", sans-serif;
  font-style: normal;
  font-weight: 400;
  font-size: 123px;
  line-height: 130%;
  display: flex;
  align-items: center;
  background: linear-gradient(310.92deg, #222a15 26.58%, #7e3617 78.53%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  color: transparent;
}

.poster-footer {
  position: absolute;
  width: 305px;
  height: 22px;
  left: 411px;
  top: 955px;
  font-family: "Abhaya Libre", "Times New Roman", serif;
  font-style: normal;
  font-weight: 800;
  font-size: 17px;
  line-height: 130%;
  display: flex;
  align-items: center;
  color: #2d2d2d;
}
```

- [ ] **Step 3: Align poster block positions to the provided geometry**

Update these poster layout rules in `styles.css`:

```css
.poster-tags-row-1 {
  top: 239px;
}

.poster-tags-row-2 {
  top: 298px;
}

.poster-species-card {
  position: absolute;
  width: 223px;
  height: 96px;
  left: 208px;
  top: 357px;
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 10px;
  gap: 10px;
  background: #ffffff;
}

.poster-stat-card {
  position: absolute;
  width: 333px;
  height: 122px;
  left: 208px;
  top: 468px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: flex-end;
  padding: 10px;
  gap: 10px;
  background: #ffffff;
}

.poster-qr-block {
  position: absolute;
  width: 127px;
  height: 127px;
  left: 524px;
  top: 755px;
  background: transparent;
}
```

- [ ] **Step 4: Keep the poster HTML selectors stable**

Ensure the poster markup in `renderDistillCampaignHtml()` still contains these exact classes:

```html
<div class="poster-title">...</div>
<div class="poster-divider"></div>
<div class="poster-tags poster-tags-row poster-tags-row-1">...</div>
<div class="poster-tags poster-tags-row poster-tags-row-2">...</div>
<div class="poster-species-card">...</div>
<div class="poster-stat-card">...</div>
<div class="poster-score">...</div>
<div class="poster-score-label">...</div>
<div class="poster-footer">Github：https://github.com/nexu-io/nexu</div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd /Users/alche/Documents/digit-sutando/nexu
pnpm exec vitest run tests/skills/deploy-skill-core.test.ts
```

Expected:
- PASS for all poster asset and CSS assertions.

- [ ] **Step 6: Commit**

```bash
git -C /Users/alche/Documents/digit-sutando/nexu add apps/desktop/static/bundled-skills/deploy-skill/templates/distill-campaign/styles.css apps/desktop/static/bundled-skills/deploy-skill/scripts/deploy_skill_core.js tests/skills/deploy-skill-core.test.ts
git -C /Users/alche/Documents/digit-sutando/nexu commit -m "fix: align deploy skill poster typography"
```

### Task 4: Update Skill Documentation To Match The Enforced Frame

**Files:**
- Modify: `apps/desktop/static/bundled-skills/deploy-skill/SKILL.md`
- Test: `tests/skills/deploy-skill-core.test.ts`

- [ ] **Step 1: Document the strict frame in the skill file**

Replace the loose template-content section in `SKILL.md` with this canonical field list:

```md
The content file must be structured JSON with this exact frame:
- `title`: 2-10 characters
- `subtitle`: 15-30 characters and must include `牛马指数`, `/100`, and `—`
- `tags`: 1-8 strings, each 2-8 characters
- `metrics`: 4-6 items total
- `posterSpeciesEmoji`
- `posterSpeciesName`: 3-8 characters
- `posterSpeciesSub`: 5-8 characters
- `description`: 150-250 characters, no markdown, HTML, or newlines
- `qaCards`: 2-3 items
- `dialogs`: 3-6 items
- `ctaText`: must equal `⭐ 生成我的牛马锐评`
- `installText`: must equal `复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill`
```

- [ ] **Step 2: Add the non-normalization rule**

Append this rule to the template section:

```md
If any field violates the frame, the skill rejects the payload and does not render. It never truncates, rewrites, or invents missing values.
```

- [ ] **Step 3: Run focused tests as regression protection**

Run:

```bash
cd /Users/alche/Documents/digit-sutando/nexu
pnpm exec vitest run tests/skills/deploy-skill-core.test.ts
```

Expected:
- PASS

- [ ] **Step 4: Commit**

```bash
git -C /Users/alche/Documents/digit-sutando/nexu add apps/desktop/static/bundled-skills/deploy-skill/SKILL.md
git -C /Users/alche/Documents/digit-sutando/nexu commit -m "docs: document deploy skill frame contract"
```

## Self-Review

- Spec coverage:
  - strict frame validation: Task 1 and Task 2
  - poster text alignment from provided CSS: Task 1 and Task 3
  - documentation sync: Task 4
- Placeholder scan:
  - no `TODO`, `TBD`, or unresolved placeholders remain
- Type consistency:
  - uses existing names `parseTemplateContent`, `renderDistillCampaignHtml`, `poster-title`, `poster-tag`, `poster-score`, `poster-footer`

