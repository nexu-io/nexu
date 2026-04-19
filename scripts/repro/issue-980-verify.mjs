import { execFile as execFileCb } from "node:child_process";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const repoRoot = process.cwd();
const controllerBase = process.env.NEXU_CONTROLLER_BASE_URL ?? "http://127.0.0.1:50800";
const stateAgentsDir = path.join(repoRoot, ".tmp/dev/openclaw/state/agents");

const fixtures = [
  {
    botId: "repro-wechat-bot",
    sessionKey: "shared-session",
    title: "Repro WeChat Session",
    channelType: "openclaw-weixin",
    timestamp: "2026-04-15T06:41:00.000Z",
    messageId: "wechat-msg-1",
    content: "这是微信专属复现消息。",
  },
  {
    botId: "repro-web-bot",
    sessionKey: "shared-session",
    title: "Repro Web Session",
    channelType: "web",
    timestamp: "2026-04-15T06:40:00.000Z",
    messageId: "web-msg-1",
    content: "This is the WEB-only repro message.",
  },
];

async function run(cmd, args, options = {}) {
  const { stdout, stderr } = await execFile(cmd, args, {
    cwd: repoRoot,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function seedFixtures() {
  for (const fixture of fixtures) {
    const sessionsDir = path.join(stateAgentsDir, fixture.botId, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const transcriptPath = path.join(sessionsDir, `${fixture.sessionKey}.jsonl`);
    const metadataPath = transcriptPath.replace(/\.jsonl$/, ".meta.json");
    const line = `${JSON.stringify({
      type: "message",
      id: fixture.messageId,
      timestamp: fixture.timestamp,
      message: {
        role: "user",
        timestamp: Date.parse(fixture.timestamp),
        content: fixture.content,
      },
    })}\n`;
    await writeFile(transcriptPath, line, "utf8");
    await writeFile(
      metadataPath,
      JSON.stringify(
        {
          title: fixture.title,
          channelType: fixture.channelType,
          status: "active",
          updatedAt: fixture.timestamp,
          createdAt: fixture.timestamp,
        },
        null,
        2,
      ),
      "utf8",
    );
    const ts = new Date(fixture.timestamp);
    await utimes(transcriptPath, ts, ts);
    await utimes(metadataPath, ts, ts);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

async function waitForSessions() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const payload = await fetchJson(`${controllerBase}/api/v1/sessions?limit=20`);
    const found = fixtures.map((fixture) =>
      payload.sessions.find(
        (session) =>
          session.botId === fixture.botId &&
          session.sessionKey === fixture.sessionKey &&
          session.title === fixture.title,
      ),
    );
    if (found.every(Boolean)) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timed out waiting for repro sessions to appear in /api/v1/sessions");
}

async function activateDesktop() {
  const script = `
    tell application "System Events"
      set appNames to name of every process whose background only is false
      if appNames contains "Nexu" then
        tell application "Nexu" to activate
      else if appNames contains "Electron" then
        tell application "Electron" to activate
      end if
    end tell
  `;
  await run("osascript", ["-e", script]);
}

async function inspectEval(expression) {
  const { stdout } = await run("pnpm", ["dev", "inspect", "eval", expression]);
  const valueMatch = stdout.match(/"value":\s*"((?:\\.|[^"\\])*)"/s);
  if (valueMatch?.[1]) {
    return JSON.parse(`"${valueMatch[1]}"`);
  }
  return stdout;
}

async function inspectScreenshot() {
  const { stdout } = await run("pnpm", ["dev", "inspect", "screenshot"]);
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.at(-1);
}

async function navigateAndCapture(session) {
  const expression = `(() => {
    const rows = Array.from(document.querySelectorAll('[data-sidebar-session-row]'));
    const target = rows.find((row) => row.textContent?.includes(${JSON.stringify(session.title)}));
    if (!(target instanceof HTMLElement)) {
      return JSON.stringify({ found: false, title: ${JSON.stringify(session.title)} });
    }
    target.click();
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const text = document.body.innerText;
          resolve(JSON.stringify({
            found: true,
            pathname: location.pathname,
            hasTitle: text.includes(${JSON.stringify(session.title)}),
            hasMessage: text.includes(${JSON.stringify(session.expectedMessage)}),
            hasWrongMessage: text.includes(${JSON.stringify(session.wrongMessage)}),
          }));
        });
      });
    });
  })()`;
  const raw = await inspectEval(expression);
  const result = JSON.parse(raw);
  const screenshotPath = await inspectScreenshot();
  return { result, screenshotPath };
}

async function main() {
  console.log("[issue-980] restarting desktop service...");
  await run("pnpm", ["dev", "restart", "desktop"]);

  console.log("[issue-980] seeding repro sessions...");
  await seedFixtures();

  console.log("[issue-980] waiting for sessions API...");
  const sessions = await waitForSessions();

  const [wechatSession, webSession] = sessions;
  wechatSession.expectedMessage = fixtures[0].content;
  wechatSession.wrongMessage = fixtures[1].content;
  webSession.expectedMessage = fixtures[1].content;
  webSession.wrongMessage = fixtures[0].content;

  console.log("[issue-980] activating desktop app...");
  await activateDesktop();

  console.log("[issue-980] capturing WeChat repro view...");
  const wechatCapture = await navigateAndCapture(wechatSession);

  console.log("[issue-980] capturing Web repro view...");
  const webCapture = await navigateAndCapture(webSession);

  const pass =
    wechatCapture.result.hasTitle &&
    wechatCapture.result.hasMessage &&
    !wechatCapture.result.hasWrongMessage &&
    webCapture.result.hasTitle &&
    webCapture.result.hasMessage &&
    !webCapture.result.hasWrongMessage;

  const output = {
    pass,
    controllerBase,
    sessions: {
      wechat: {
        id: wechatSession.id,
        title: wechatSession.title,
        capture: wechatCapture,
      },
      web: {
        id: webSession.id,
        title: webSession.title,
        capture: webCapture,
      },
    },
  };

  console.log(JSON.stringify(output, null, 2));

  if (!pass) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[issue-980] verification failed", error);
  process.exitCode = 1;
});
