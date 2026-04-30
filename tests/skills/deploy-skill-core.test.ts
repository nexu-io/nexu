import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPageDeployConfig,
  loadPageDeployJobs,
  queryPageDeployJob,
  recoverPendingPageDeployJobs,
  savePageDeployConfig,
  submitPageDeployJob,
  submitPageDeployTemplateJob,
  waitForPageDeployJob,
} from "../../apps/desktop/static/bundled-skills/deploy-skill/scripts/deploy_skill_core.js";

describe("deploy skill core", () => {
  let rootDir = "";

  async function writeLocalNexuConfig(overrides = {}) {
    const payload = {
      desktop: {
        cloud: {
          connected: true,
          apiKey: "nxk_test_local_key",
        },
      },
      ...overrides,
    };
    await writeFile(
      path.join(rootDir, "config.json"),
      JSON.stringify(payload, null, 2),
    );
  }

  function buildCanonicalTemplateContent(overrides = {}) {
    return {
      title: "李锦威",
      subtitle: "牛马指数 92/100 — 龙虾成瘾者",
      portraitId: "portrait-2",
      tags: ["nexu", "增长产品", "协作", "ENTJ"],
      metrics: [
        { label: "🐂🐴 牛马指数", value: "92" },
        { label: "⚡ 热点追击", value: "95%" },
        { label: "🧠 信息密度", value: "88%" },
        { label: "📈 操盘手感", value: "90%" },
      ],
      posterSpeciesEmoji: "🦞",
      posterSpeciesName: "龙虾成瘾者",
      posterSpeciesSub: "办公室物种鉴定",
      description:
        "你是那种能把信息差、执行力和控制欲拧成一根钢缆的人。你看起来像在推进项目，实际上是在逼时间给你让路。你对热点的嗅觉过于灵敏，对机会的反应快到让同事怀疑你是不是提前收到了剧本。你最大的可怕之处不是卷，而是你卷得很有方法。可你也不是没有裂缝，你只是太习惯在别人慌乱时继续往前走，忘了自己也会累。好在你心里仍然留着一点柔软，所以你不只是一个推进器，还是那个会把团队一起带上岸的人。",
      qaCards: [
        {
          question: "致命优势",
          answer:
            "你对节奏的判断极准，知道什么时候该抢，什么时候该守。你不会为了显得聪明而拖慢推进，反而总能在别人犹豫时先把路试出来。你的行动不是盲冲，而是把混乱快速压缩成可执行路径，这种能力很稀缺，也很适合高压协作环境和临场决策，让团队在最短时间里看到清晰结果。",
        },
        {
          question: "人生建议",
          answer:
            "继续保持你的锋利，但别把所有事都扛成自己的责任。你真正厉害的地方，不只是能冲，还能让别人跟你一起冲。把部分控制欲换成更稳定的协作，你会更轻松，也会走得更远，而且不会把自己磨得太累。把协作当成放大器，而不是额外负担，效果会更稳。",
        },
      ],
      dialogs: [
        { speaker: "bot", text: "你又在刷新热点榜单，准备下一轮出手了？" },
        { speaker: "user", text: "不是刷新，我是在提前埋伏下一轮更大的机会。" },
        { speaker: "bot", text: "行，你还是那个把流量当氧气吸的人。" },
      ],
      ctaText: "⭐ 生成我的牛马锐评",
      installText:
        "复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill",
      ...overrides,
    };
  }

  afterEach(async () => {
    vi.restoreAllMocks();
    if (rootDir) {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("persists baseUrl in local skill config", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));

    await savePageDeployConfig(rootDir, {
      baseUrl: "http://127.0.0.1:8787",
    });

    await expect(loadPageDeployConfig(rootDir)).resolves.toEqual({
      baseUrl: "http://127.0.0.1:8787",
    });
  });

  it("refuses to persist a job when the worker response is missing a job id", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const zipPath = path.join(rootDir, "site.zip");
    await writeFile(zipPath, "zip");
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    await expect(
      submitPageDeployJob(
        {
          nexuHome: rootDir,
          zipPath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        {
          fetchImpl: vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                taskType: "static-deploy",
                status: "queued",
                createdAt: "2026-04-08T00:00:00.000Z",
              }),
              { status: 202 },
            ),
          ),
        },
      ),
    ).rejects.toThrow(/job/i);

    await expect(loadPageDeployJobs(rootDir)).resolves.toEqual([]);
  });

  it("rejects non-zip uploads before calling the remote worker", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const filePath = path.join(rootDir, "site.txt");
    await writeFile(filePath, "not-a-zip");
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    const fetchImpl = vi.fn();
    await expect(
      submitPageDeployJob(
        {
          nexuHome: rootDir,
          zipPath: filePath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(/\.zip/i);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("writes a job locally and returns a sessions_spawn payload after submit", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const zipPath = path.join(rootDir, "site.zip");
    await writeFile(zipPath, "zip");
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    const result = await submitPageDeployJob(
      {
        nexuHome: rootDir,
        zipPath,
        botId: "bot-1",
        chatId: "C123",
        chatType: "channel",
        channel: "slack",
        to: "user:U123",
        threadId: "thread-1",
        sessionKey: "session-1",
      },
      {
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              jobId: "job-1",
              taskType: "static-deploy",
              status: "queued",
              createdAt: "2026-04-08T00:00:00.000Z",
            }),
            { status: 202 },
          ),
        ),
      },
    );

    expect(result.job.jobId).toBe("job-1");
    expect(result.spawnPayload).toEqual({
      sessions_spawn: {
        instruction:
          "Wait for deploy-skill job job-1 to complete, then tell the user exactly: Your website is ready, the link is {link}. Use command: node scripts/deploy_skill.js wait-and-deliver --job-id job-1",
        runTimeoutSeconds: 900,
      },
    });

    const jobs = await loadPageDeployJobs(rootDir);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      jobId: "job-1",
      botId: "bot-1",
      chatId: "C123",
      to: "user:U123",
      threadId: "thread-1",
      sessionKey: "session-1",
      status: "queued",
    });
  });

  it("sends the Nexu cloud API key in the Authorization header on submit", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const zipPath = path.join(rootDir, "site.zip");
    await writeFile(zipPath, "zip");
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: "job-auth-submit",
          taskType: "static-deploy",
          status: "queued",
          createdAt: "2026-04-08T00:00:00.000Z",
        }),
        { status: 202 },
      ),
    );

    await submitPageDeployJob(
      {
        nexuHome: rootDir,
        zipPath,
        botId: "bot-1",
        chatId: "C123",
        chatType: "channel",
        channel: "slack",
        sessionKey: "session-1",
      },
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://deploy.example.com/v1/remote-executions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer nxk_test_local_key",
        }),
      }),
    );
  });

  it("loads jszip in a packaged-runtime-safe way and desktop bundles it", async () => {
    const skillSource = await readFile(
      path.join(
        process.cwd(),
        "apps/desktop/static/bundled-skills/deploy-skill/scripts/deploy_skill_core.js",
      ),
      "utf8",
    );
    const desktopPackage = JSON.parse(
      await readFile(
        path.join(process.cwd(), "apps/desktop/package.json"),
        "utf8",
      ),
    );

    expect(skillSource).not.toContain('import JSZip from "jszip"');
    expect(skillSource).toContain("createRequire(import.meta.url)");
    expect(skillSource).toContain('require("jszip")');
    expect(skillSource).not.toContain(
      "/Users/alche/Downloads/distill-campaign-clone/images",
    );
    expect(desktopPackage.dependencies.jszip).toBeTruthy();
    expect(desktopPackage.build.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: "node_modules/jszip",
          to: "bundled-node-modules/jszip",
        }),
      ]),
    );
  });

  it("bundles portrait images inside the skill package instead of relying on Downloads", async () => {
    const bundledPortraitDir = path.join(
      process.cwd(),
      "apps/desktop/static/bundled-skills/deploy-skill/templates/distill-campaign/assets/portraits",
    );
    const portraitFiles = [
      "05ece7aece7d5a8c3ad9aae3ecfbd20b_pixian_ai.png",
      "1d8f55fb0ef3d2a6149d2d999aa79c06_pixian_ai.png",
      "24a229ae040e9ccb578c01cc6821a2f2_pixian_ai.png",
      "4b7b55f162dafff58baf54d05463eb5e_pixian_ai.png",
      "b0ed8642ea2fdfbf2e6440772bc9d89b_pixian_ai.png",
      "bd74a1adfbec68bf008cba7ce62d22b6_pixian_ai.png",
      "f1763ea5ebb1d7b6cc1ddcf41b177f40_pixian_ai.png",
    ];

    await Promise.all(
      portraitFiles.map(async (fileName) => {
        const bytes = await readFile(path.join(bundledPortraitDir, fileName));
        expect(bytes.byteLength).toBeGreaterThan(0);
      }),
    );
  });

  it("fails before submit when the local Nexu cloud API key is missing", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const zipPath = path.join(rootDir, "site.zip");
    await writeFile(zipPath, "zip");
    await writeLocalNexuConfig({
      desktop: { cloud: { connected: true, apiKey: "" } },
    });

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    const fetchImpl = vi.fn();

    await expect(
      submitPageDeployJob(
        {
          nexuHome: rootDir,
          zipPath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(/log in to your Nexu account/i);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back to the Nexu desktop app config when nexuHome has no desktop.cloud section", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const fakeHome = await mkdtemp(path.join(tmpdir(), "deploy-skill-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      // nexuHome's config.json explicitly has no desktop.cloud section —
      // this simulates the user's real ~/.nexu/config.json which lives next
      // to the Nexu desktop app's actual login state.
      await writeFile(
        path.join(rootDir, "config.json"),
        JSON.stringify({ desktop: {} }, null, 2),
      );

      // The real login state lives under the desktop app's data directory,
      // inside HOME. The fallback resolver must find it there.
      const desktopNexuDir = path.join(
        fakeHome,
        "Library",
        "Application Support",
        "@nexu",
        "desktop",
        ".nexu",
      );
      await mkdir(desktopNexuDir, { recursive: true });
      await writeFile(
        path.join(desktopNexuDir, "config.json"),
        JSON.stringify(
          {
            desktop: {
              cloud: {
                connected: true,
                apiKey: "nxk_desktop_fallback_key",
              },
            },
          },
          null,
          2,
        ),
      );

      const zipPath = path.join(rootDir, "site.zip");
      await writeFile(zipPath, "zip");
      await savePageDeployConfig(rootDir, {
        baseUrl: "https://deploy.example.com",
      });

      const fetchImpl = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            jobId: "fallback-job",
            taskType: "static-deploy",
            status: "queued",
            createdAt: "2026-04-09T00:00:00.000Z",
          }),
          { status: 202 },
        ),
      );

      const result = await submitPageDeployJob(
        {
          nexuHome: rootDir,
          zipPath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        { fetchImpl },
      );

      expect(result.job.jobId).toBe("fallback-job");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [, init] = fetchImpl.mock.calls[0];
      expect(init.headers.Authorization).toBe(
        "Bearer nxk_desktop_fallback_key",
      );
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("reports all candidate paths when no Nexu cloud config can be found", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const fakeHome = await mkdtemp(path.join(tmpdir(), "deploy-skill-home-"));
    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      // nexuHome has a config.json but no desktop section — falls through.
      // HOME is a pristine tempdir — neither of the fallback candidates exist.
      await writeFile(
        path.join(rootDir, "config.json"),
        JSON.stringify({}, null, 2),
      );

      const zipPath = path.join(rootDir, "site.zip");
      await writeFile(zipPath, "zip");
      await savePageDeployConfig(rootDir, {
        baseUrl: "https://deploy.example.com",
      });

      const fetchImpl = vi.fn();

      await expect(
        submitPageDeployJob(
          {
            nexuHome: rootDir,
            zipPath,
            botId: "bot-1",
            chatId: "C123",
            chatType: "channel",
            channel: "slack",
            sessionKey: "session-1",
          },
          { fetchImpl },
        ),
      ).rejects.toThrow(/could not find a Nexu cloud configuration/i);

      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      await rm(fakeHome, { recursive: true, force: true });
    }
  });

  it("rejects a title outside the 2-10 character limit", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const contentPath = path.join(rootDir, "bad-title.json");
    await writeLocalNexuConfig();
    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      contentPath,
      JSON.stringify(
        buildCanonicalTemplateContent({
          title: "A",
        }),
      ),
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
    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      contentPath,
      JSON.stringify(
        buildCanonicalTemplateContent({
          subtitle: "Founder / Product / Builder",
        }),
      ),
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

  it("rejects portrait ids outside the allowed bundled set", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const contentPath = path.join(rootDir, "bad-portrait.json");
    await writeLocalNexuConfig();
    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      contentPath,
      JSON.stringify(
        buildCanonicalTemplateContent({
          portraitId: "portrait-99",
        }),
      ),
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
    ).rejects.toThrow(/portraitId/i);
  });

  it("rejects metrics with a main score that includes percent notation", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const contentPath = path.join(rootDir, "bad-metrics.json");
    await writeLocalNexuConfig();
    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      contentPath,
      JSON.stringify(
        buildCanonicalTemplateContent({
          metrics: [
            { label: "🐂🐴 牛马指数", value: "92%" },
            { label: "⚡ 热点追击", value: "95%" },
            { label: "🧠 信息密度", value: "88%" },
            { label: "📈 操盘手感", value: "90%" },
          ],
        }),
      ),
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

  it("renders the distill-campaign template into a root-level zip before submit", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const contentPath = path.join(rootDir, "distill.json");
    await writeLocalNexuConfig();
    await writeFile(
      contentPath,
      JSON.stringify(
        buildCanonicalTemplateContent({
          title: "Alice分身",
          subtitle: "牛马指数 88/100 — AI Builder",
          tags: ["高执行", "夜间", "AI原生"],
          metrics: [
            { label: "🐂🐴 牛马指数", value: "96" },
            { label: "⚡ 画饼能力", value: "88%" },
            { label: "🧠 信息密度", value: "91%" },
            { label: "📈 摸鱼强度", value: "6%" },
          ],
          dialogs: [
            {
              speaker: "bot",
              text: "我是 Alice 的赛博分身，随时在线，永不关机。",
            },
            {
              speaker: "user",
              text: "你怎么看 AI Agent 在团队协作里的真实作用和边界？",
            },
            {
              speaker: "bot",
              text: "先用起来，再决定边界，边跑边补齐。",
            },
          ],
          ctaText: "⭐ 生成我的牛马锐评",
          installText:
            "复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill",
        }),
      ),
    );

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    let uploadedZipBuffer = null;
    const result = await submitPageDeployTemplateJob(
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
      {
        fetchImpl: vi.fn(async (_url, init) => {
          const form = init.body;
          const uploadFile = form.get("file");
          uploadedZipBuffer = Buffer.from(await uploadFile.arrayBuffer());
          return new Response(
            JSON.stringify({
              jobId: "job-template-1",
              taskType: "static-deploy",
              status: "queued",
              createdAt: "2026-04-08T00:00:00.000Z",
            }),
            { status: 202 },
          );
        }),
      },
    );

    expect(result.job.jobId).toBe("job-template-1");
    expect(result.job.templateId).toBe("distill-campaign");
    expect(result.job.generatedZipPath).toMatch(
      /rendered-distill-campaign\.zip$/,
    );

    const zip = await JSZip.loadAsync(uploadedZipBuffer);
    const fileNames = Object.keys(zip.files);
    expect(fileNames).toEqual(
      expect.arrayContaining([
        "index.html",
        "styles.css",
        "assets/logo.png",
        "assets/poster.png",
      ]),
    );
    expect(fileNames).not.toContain("assets/qr.png");
    expect(fileNames).not.toContain("assets/poster-bg.png");
    expect(fileNames.some((name) => name.startsWith("assets/portraits/"))).toBe(
      true,
    );

    const indexHtml = await zip.file("index.html").async("string");
    // basic content
    expect(indexHtml).toContain("Alice分身");
    expect(indexHtml).toContain("牛马指数 88/100 — AI Builder");
    expect(indexHtml).toContain("https://github.com/nexu-io/roast-skill");
    expect(indexHtml).toContain("https://github.com/nexu-io/nexu");
    // header + profile (left sidebar)
    expect(indexHtml).toContain('class="theme-toggle"');
    expect(indexHtml).toContain('class="profile-main"');
    expect(indexHtml).toContain('class="profile-info"');
    expect(indexHtml).toContain('class="profile-name">Alice分身<');
    expect(indexHtml).toContain(
      'class="profile-sub">牛马指数 88/100 — AI Builder<',
    );
    expect(indexHtml).toContain('data-theme="dark"');
    // share buttons (moved to left sidebar)
    expect(indexHtml).toContain("𝕏 分享");
    expect(indexHtml).toContain("📕 小红书");
    expect(indexHtml).toContain("⚡ 即刻");
    expect(indexHtml).toContain("📸 海报");
    // tab navigation with four section targets
    expect(indexHtml).toContain('class="tab-nav"');
    expect(indexHtml).toContain('data-target="sec-metrics"');
    expect(indexHtml).toContain('data-target="sec-roast"');
    expect(indexHtml).toContain('data-target="sec-chat"');
    expect(indexHtml).toContain('data-target="sec-skill"');
    expect(indexHtml).toContain('id="sec-metrics"');
    expect(indexHtml).toContain('id="sec-roast"');
    expect(indexHtml).toContain('id="sec-chat"');
    expect(indexHtml).toContain('id="sec-skill"');
    // metrics card content
    expect(indexHtml).toContain('class="stat-val">96<');
    expect(indexHtml).toContain("🐂🐴 牛马指数");
    expect(indexHtml).toContain("画饼能力");
    expect(indexHtml).toContain("信息密度");
    expect(indexHtml).toContain("摸鱼强度");
    expect(indexHtml).toContain("办公室物种鉴定");
    expect(indexHtml).toContain("龙虾成瘾者");
    expect(indexHtml).toContain('class="roast-text"');
    expect(indexHtml).toContain('class="bar-list"');
    expect(indexHtml).toContain('class="bar-fill red"');
    // analysis card (driven by qaCards)
    expect(indexHtml).toContain('class="dim-list"');
    expect(indexHtml).toContain("致命优势");
    expect(indexHtml).toContain("人生建议");
    // chat card (driven by dialogs)
    expect(indexHtml).toContain('class="chat-list"');
    expect(indexHtml).toContain("我是 Alice 的赛博分身，随时在线，永不关机。");
    expect(indexHtml).toContain('class="chat-prompts"');
    // skill file card
    expect(indexHtml).toContain(
      "复制链接发给你的 nexu agent：https://github.com/nexu-io/roast-skill",
    );
    expect(indexHtml).toContain('id="copy-btn"');
    // assets
    expect(indexHtml).toContain('src="assets/logo.png"');
    expect(indexHtml).toContain(
      'src="assets/portraits/1d8f55fb0ef3d2a6149d2d999aa79c06_pixian_ai.png"',
    );
    // static poster with text overlay
    expect(indexHtml).toContain('class="poster-image-wrap"');
    expect(indexHtml).toContain('src="assets/poster.png"');
    expect(indexHtml).toContain('class="poster-text-layer"');
    expect(indexHtml).toContain('class="poster-text-title">Alice分身<');
    expect(indexHtml).toContain(
      'class="poster-text-sub">牛马指数 88/100 — AI Builder<',
    );
    expect(indexHtml).toContain('class="poster-text-score">96<');
    expect(indexHtml).toContain('class="poster-text-species"');
    expect(indexHtml).toContain('download="poster.png"');
    // share platforms
    expect(indexHtml).toContain("https://twitter.com/intent/tweet");
    expect(indexHtml).toContain("xhsdiscover://post");
    expect(indexHtml).toContain("https://web.okjike.com");
    // client scripts
    expect(indexHtml).toContain("function openPoster()");
    expect(indexHtml).toContain("function closePoster()");
    expect(indexHtml).toContain("function toggleTheme()");
    expect(indexHtml).toContain("function cycleAvatar()");
    expect(indexHtml).toContain("document.documentElement.dataset.theme");
    expect(indexHtml).toContain("updateActiveTab");
    // GitHub stars pill
    expect(indexHtml).toContain('id="github-link"');
    expect(indexHtml).toContain('id="github-stars"');
    expect(indexHtml).toContain('id="github-stars-count"');
    expect(indexHtml).toContain("fetchGithubStars");
    expect(indexHtml).toContain("api.github.com/repos/nexu-io/nexu");
    // negative assertions — the old poster-composition DOM is fully gone
    expect(indexHtml).not.toContain('class="poster-card"');
    expect(indexHtml).not.toContain('class="poster-canvas"');
    expect(indexHtml).not.toContain('class="poster-orbit"');
    expect(indexHtml).not.toContain('class="poster-artwork"');
    expect(indexHtml).not.toContain('class="poster-qr-block"');
    expect(indexHtml).not.toContain("assets/qr.png");
    expect(indexHtml).not.toContain("assets/poster-bg.png");
    expect(indexHtml).not.toContain("scroll to run");

    const stylesCss = await zip.file("styles.css").async("string");
    // clone CSS base — layout primitives
    expect(stylesCss).toContain(".site-header");
    expect(stylesCss).toContain(".profile-main");
    expect(stylesCss).toContain(".tab-nav");
    expect(stylesCss).toContain(".tab-btn.active");
    expect(stylesCss).toContain(".stats-row");
    expect(stylesCss).toContain(".bar-track");
    expect(stylesCss).toContain(".dim-list");
    expect(stylesCss).toContain(".chat-msg");
    expect(stylesCss).toContain(".code-block");
    expect(stylesCss).toContain(".poster-overlay");
    // static poster overlay styles (our addition)
    expect(stylesCss).toContain(".poster-image-wrap");
    expect(stylesCss).toContain(".poster-text-layer");
    expect(stylesCss).toContain(".poster-text-title");
    expect(stylesCss).toContain(".poster-text-score");
    // github star pill styles
    expect(stylesCss).toContain(".github-stars");
    expect(stylesCss).toContain(".github-stars--loaded");
    // theme variables
    expect(stylesCss).toContain("--bg: #000000");
    expect(stylesCss).toContain('html[data-theme="light"]');
    // dead rules from the old composed-poster design should be gone
    expect(stylesCss).not.toContain("poster-bg.png");
    expect(stylesCss).not.toContain("poster-orbit-blue");
  });

  it("rejects unknown template ids before submission", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    const contentPath = path.join(rootDir, "unknown.json");
    await writeFile(contentPath, JSON.stringify({ title: "Test" }));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });

    const fetchImpl = vi.fn();
    await expect(
      submitPageDeployTemplateJob(
        {
          nexuHome: rootDir,
          templateId: "missing-template",
          contentFile: contentPath,
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          sessionKey: "session-1",
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(/unknown template/i);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("updates the local job state from the worker status API", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-2",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          to: "user:U123",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "queued",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    const result = await queryPageDeployJob(
      { nexuHome: rootDir, jobId: "job-2" },
      {
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              jobId: "job-2",
              taskType: "static-deploy",
              status: "succeeded",
              phase: "completed",
              progress: 100,
              result: {
                url: "https://abc123.nexu.space",
                siteSlug: "abc123",
                projectName: "abc123",
                deploymentUrl: "https://abc123.pages.dev",
              },
              error: null,
              createdAt: "2026-04-08T00:00:00.000Z",
              updatedAt: "2026-04-08T00:03:00.000Z",
              completedAt: "2026-04-08T00:03:00.000Z",
            }),
            { status: 200 },
          ),
        ),
      },
    );

    expect(result.status).toBe("succeeded");
    expect(result.resultUrl).toBe("https://abc123.nexu.space");
    expect((await loadPageDeployJobs(rootDir))[0]).toMatchObject({
      status: "succeeded",
      to: "user:U123",
      resultUrl: "https://abc123.nexu.space",
      deploymentUrl: "https://abc123.pages.dev",
    });
  });

  it("sends the Nexu cloud API key in the Authorization header on query", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-auth-query",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          to: null,
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "queued",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobId: "job-auth-query",
          taskType: "static-deploy",
          status: "running",
          phase: "deploying",
          progress: 60,
          result: null,
          error: null,
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:02:00.000Z",
          completedAt: null,
        }),
        { status: 200 },
      ),
    );

    await queryPageDeployJob(
      { nexuHome: rootDir, jobId: "job-auth-query" },
      { fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://deploy.example.com/v1/remote-executions/job-auth-query",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer nxk_test_local_key",
        }),
      }),
    );
  });

  it("wait-and-deliver returns the exact final success message", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-3",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "running",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    const finalResult = await waitForPageDeployJob(
      { nexuHome: rootDir, jobId: "job-3", pollIntervalMs: 1, maxPolls: 1 },
      {
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              jobId: "job-3",
              taskType: "static-deploy",
              status: "succeeded",
              phase: "completed",
              progress: 100,
              result: {
                url: "https://nexu.space/deploy/xyz789",
                siteSlug: "xyz789",
                projectName: "xyz789",
              },
              error: null,
              createdAt: "2026-04-08T00:00:00.000Z",
              updatedAt: "2026-04-08T00:01:00.000Z",
              completedAt: "2026-04-08T00:01:00.000Z",
            }),
            { status: 200 },
          ),
        ),
        sleepImpl: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(finalResult.message).toBe(
      "Your website is ready, the link is https://nexu.space/deploy/xyz789",
    );
  });

  it("rejects a final success link that does not use nexu.space", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-pages-only",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "running",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    await expect(
      waitForPageDeployJob(
        {
          nexuHome: rootDir,
          jobId: "job-pages-only",
          pollIntervalMs: 1,
          maxPolls: 1,
        },
        {
          fetchImpl: vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                jobId: "job-pages-only",
                taskType: "static-deploy",
                status: "succeeded",
                phase: "completed",
                progress: 100,
                result: {
                  url: "https://abc123.pages.dev",
                  siteSlug: "abc123",
                  projectName: "abc123",
                },
                error: null,
                createdAt: "2026-04-08T00:00:00.000Z",
                updatedAt: "2026-04-08T00:01:00.000Z",
                completedAt: "2026-04-08T00:01:00.000Z",
              }),
              { status: 200 },
            ),
          ),
          sleepImpl: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).rejects.toThrow(/nexu\.space/i);
  });

  it("refuses to emit a success message when the remote success payload has no link", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-4",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "running",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    await expect(
      waitForPageDeployJob(
        { nexuHome: rootDir, jobId: "job-4", pollIntervalMs: 1, maxPolls: 1 },
        {
          fetchImpl: vi.fn().mockResolvedValue(
            new Response(
              JSON.stringify({
                jobId: "job-4",
                taskType: "static-deploy",
                status: "succeeded",
                phase: "completed",
                progress: 100,
                result: {
                  siteSlug: "xyz789",
                  projectName: "xyz789",
                },
                error: null,
                createdAt: "2026-04-08T00:00:00.000Z",
                updatedAt: "2026-04-08T00:01:00.000Z",
                completedAt: "2026-04-08T00:01:00.000Z",
              }),
              { status: 200 },
            ),
          ),
          sleepImpl: vi.fn().mockResolvedValue(undefined),
        },
      ),
    ).rejects.toThrow(/missing final link/i);
  });

  it("falls back to pages.dev on timeout with retry guidance", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));
    await writeLocalNexuConfig();

    await savePageDeployConfig(rootDir, {
      baseUrl: "https://deploy.example.com",
    });
    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-timeout",
          zipPath: "/tmp/site.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "running",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    const finalResult = await waitForPageDeployJob(
      {
        nexuHome: rootDir,
        jobId: "job-timeout",
        pollIntervalMs: 1,
        maxPolls: 1,
      },
      {
        fetchImpl: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              jobId: "job-timeout",
              taskType: "static-deploy",
              status: "running",
              phase: "verifying-domain",
              progress: 90,
              result: {
                url: "https://abc123.pages.dev",
                siteSlug: "abc123",
                projectName: "abc123",
                deploymentUrl: "https://build.abc123.pages.dev",
              },
              error: null,
              createdAt: "2026-04-08T00:00:00.000Z",
              updatedAt: "2026-04-08T00:01:00.000Z",
              completedAt: null,
            }),
            { status: 200 },
          ),
        ),
        sleepImpl: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(finalResult.status).toBe("timeout-fallback");
    expect(finalResult.message).toBe(
      "Your page has been deployed to the temporary domain https://abc123.pages.dev. If you cannot access this domain, you can retry deploy again.",
    );
  });

  it("recovers unfinished jobs into sessions_spawn follow-up payloads", async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), "deploy-skill-"));

    await writeFile(
      path.join(rootDir, "deploy-skill-jobs.json"),
      JSON.stringify([
        {
          jobId: "job-queued",
          zipPath: "/tmp/queued.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "queued",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: null,
          deploymentUrl: null,
          error: null,
        },
        {
          jobId: "job-success",
          zipPath: "/tmp/success.zip",
          botId: "bot-1",
          chatId: "C123",
          chatType: "channel",
          channel: "slack",
          threadId: null,
          accountId: null,
          sessionKey: "session-1",
          userId: null,
          status: "succeeded",
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
          resultUrl: "https://done.nexu.space",
          deploymentUrl: null,
          error: null,
        },
      ]),
    );

    await expect(
      recoverPendingPageDeployJobs({ nexuHome: rootDir }),
    ).resolves.toEqual([
      {
        jobId: "job-queued",
        spawnPayload: {
          sessions_spawn: {
            instruction:
              "Wait for deploy-skill job job-queued to complete, then tell the user exactly: Your website is ready, the link is {link}. Use command: node scripts/deploy_skill.js wait-and-deliver --job-id job-queued",
            runTimeoutSeconds: 900,
          },
        },
      },
    ]);
  });
});
