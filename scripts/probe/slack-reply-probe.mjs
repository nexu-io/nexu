import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const scriptFilePath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFilePath), "../..");
const defaultProfileDir = path.join(
  repoRoot,
  ".tmp",
  "slack-reply-probe",
  "chrome-profile-manual",
);
const defaultPrepareUrl = process.env.SLACK_PROBE_PREPARE_URL ?? null;
const defaultConnectUrl = process.env.SLACK_PROBE_CONNECT_URL ?? null;
const defaultTimeoutMs = Number(process.env.SLACK_PROBE_TIMEOUT_MS ?? "15000");
const defaultPrepareTimeoutMs = Number(
  process.env.SLACK_PROBE_PREPARE_TIMEOUT_MS ?? "600000",
);
const defaultReplyTimeoutMs = Number(
  process.env.SLACK_PROBE_REPLY_TIMEOUT_MS ?? "90000",
);
const browserChannel = process.env.SLACK_PROBE_BROWSER_CHANNEL ?? "chrome";

function parseArgs(argv) {
  const options = {
    mode: "send",
    profileDir: defaultProfileDir,
    slackUrl: null,
    prepareUrl: defaultPrepareUrl,
    connectUrl: defaultConnectUrl,
    headless: false,
    resetProfile: false,
    timeoutMs: defaultTimeoutMs,
    prepareTimeoutMs: defaultPrepareTimeoutMs,
    replyTimeoutMs: defaultReplyTimeoutMs,
    message: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--headless") {
      options.headless = true;
      continue;
    }
    if (arg === "--reset-profile") {
      options.resetProfile = true;
      continue;
    }
    if (arg === "--profile-dir") {
      options.profileDir = path.resolve(argv[index + 1] ?? options.profileDir);
      index += 1;
      continue;
    }
    if (arg === "--url") {
      options.slackUrl = argv[index + 1] ?? options.slackUrl;
      index += 1;
      continue;
    }
    if (arg === "--prepare-url") {
      options.prepareUrl = argv[index + 1] ?? options.prepareUrl;
      index += 1;
      continue;
    }
    if (arg === "--connect-url") {
      options.connectUrl = argv[index + 1] ?? options.connectUrl;
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      const nextValue = Number(argv[index + 1] ?? options.timeoutMs);
      if (!Number.isNaN(nextValue) && nextValue > 0) {
        options.timeoutMs = nextValue;
      }
      index += 1;
      continue;
    }
    if (arg === "--reply-timeout-ms") {
      const nextValue = Number(argv[index + 1] ?? options.replyTimeoutMs);
      if (!Number.isNaN(nextValue) && nextValue > 0) {
        options.replyTimeoutMs = nextValue;
      }
      index += 1;
      continue;
    }
    if (arg === "--message") {
      options.message = argv[index + 1] ?? options.message;
      index += 1;
      continue;
    }
    if (arg === "session") {
      options.mode = "session";
      continue;
    }
    if (arg === "inspect") {
      options.mode = "inspect";
      continue;
    }
    if (arg === "send") {
      options.mode = "send";
      continue;
    }
    if (arg === "prepare") {
      options.mode = "prepare";
      continue;
    }
    if (arg === "open") {
      options.mode = "open";
      continue;
    }
    if (arg === "help" || arg === "--help" || arg === "-h") {
      options.mode = "help";
    }
  }

  return options;
}

function printUsage() {
  console.log(
    [
      "Slack Reply Probe",
      "",
      "Usage:",
      "  pnpm probe:slack --url <slack-dm-url>                    # send one probe message and wait for reply",
      "  pnpm probe:slack -- session",
      "  pnpm probe:slack -- inspect",
      "  pnpm probe:slack -- send",
      "  pnpm probe:slack -- prepare",
      "  pnpm probe:slack -- --headless",
      "  pnpm probe:slack -- --reset-profile",
      "",
      "Options:",
      "  session           Check whether the saved Slack browser profile is authenticated",
      "  inspect           Print Slack DM composer and message-list selector diagnostics",
      "  send              Send one probe message and wait for a new reply",
      "  prepare           Open Slack sign-in and wait for a reusable logged-in session",
      "  open              Open the target Slack page with the persistent profile",
      "  --profile-dir     Override the persistent browser profile directory",
      "  --url             Slack DM URL to probe (required)",
      "  --prepare-url     Override the initial sign-in URL used by prepare mode",
      "  --connect-url     Reuse an already running Chrome instance over CDP",
      "  --timeout-ms      Override page wait timeout in milliseconds",
      "  --reply-timeout-ms Override reply wait timeout in milliseconds",
      "  --message         Override the sent probe message body",
      "  --headless        Run without showing the browser window",
      "  --reset-profile   Delete the saved probe profile before launch",
    ].join("\n"),
  );
}

function formatBoolean(value) {
  return value ? "yes" : "no";
}

async function detectSession(page, expectedUrl, timeoutMs) {
  await page.goto(expectedUrl, {
    timeout: timeoutMs,
    waitUntil: "domcontentloaded",
  });

  await page.waitForTimeout(2000);

  const currentUrl = page.url();
  const bodyText = (await page.locator("body").textContent()) ?? "";
  const normalizedText = bodyText.replace(/\s+/g, " ").trim();
  const title = await page.title().catch(() => "");

  const redirectedToSignIn =
    currentUrl.includes("/signin") ||
    currentUrl.includes("/checkcookie") ||
    currentUrl.includes("/ssb/signin");

  const composerVisible = await page
    .locator('[contenteditable="true"], div[role="textbox"], textarea')
    .first()
    .isVisible()
    .catch(() => false);

  const workspaceShellVisible = await page
    .locator(
      'a[href*="/client/"], button[aria-label*="Later"], [data-qa="message_input"]',
    )
    .first()
    .isVisible()
    .catch(() => false);

  const loadErrorVisible =
    !composerVisible &&
    !workspaceShellVisible &&
    (/unable to load slack|couldn't load slack|无法加载\s*slack|故障排除/i.test(
      normalizedText,
    ) ||
      /unable to load slack/i.test(title));

  const looksAuthenticated =
    !redirectedToSignIn &&
    !loadErrorVisible &&
    (composerVisible || workspaceShellVisible);

  return {
    looksAuthenticated,
    currentUrl,
    title,
    redirectedToSignIn,
    loadErrorVisible,
    composerVisible,
    workspaceShellVisible,
    bodyPreview: normalizedText.slice(0, 280),
  };
}

function buildPrepareUrl(slackUrl) {
  if (defaultPrepareUrl) {
    return defaultPrepareUrl;
  }
  const parsedUrl = new URL(slackUrl);
  const redirectPath = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  return `https://app.slack.com/client/signin?redir=${encodeURIComponent(redirectPath)}`;
}

async function waitForReusableSession(page, targetUrl, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const session = await detectSession(
      page,
      targetUrl,
      defaultTimeoutMs,
    ).catch(() => null);
    if (session?.looksAuthenticated) {
      return session;
    }
    await page.waitForTimeout(3000);
  }

  return null;
}

async function openPreparePage(page, prepareUrl, timeoutMs) {
  try {
    await page.goto(prepareUrl, {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("page.goto: Timeout")) {
      throw error;
    }

    console.log(
      "[probe] initial Slack sign-in navigation timed out, but the page may still be usable. Keeping the browser open and continuing session polling.",
    );
  }
}

async function ensureProfileDirectory(profileDir, resetProfile) {
  if (resetProfile && existsSync(profileDir)) {
    await rm(profileDir, { recursive: true, force: true });
  }
  await mkdir(profileDir, { recursive: true });
}

async function inspectSlackDm(page) {
  const composerCandidates = [
    '[data-qa="message_input"]',
    '[data-qa="message_input"] [contenteditable="true"]',
    '[role="textbox"]',
    '[contenteditable="true"]',
    'div[aria-label*="Message"]',
    'div[aria-label*="message"]',
    'div[data-qa="message_input"] div[contenteditable="true"]',
  ];
  const messageCandidates = [
    '[data-qa="virtual-list-item"]',
    '[data-qa="message_container"]',
    '[data-qa="message_content"]',
    '[role="listitem"]',
  ];
  const sendButtonCandidates = [
    'button[aria-label*="Send"]',
    'button[data-qa="texty_send_button"]',
    'button[aria-label*="发送"]',
  ];

  const composerDiagnostics = [];
  for (const selector of composerCandidates) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    const first = locator.first();
    const visible =
      count > 0 ? await first.isVisible().catch(() => false) : false;
    const text =
      count > 0
        ? ((await first.textContent().catch(() => "")) ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120)
        : "";
    const ariaLabel =
      count > 0
        ? await first.getAttribute("aria-label").catch(() => null)
        : null;

    composerDiagnostics.push({ selector, count, visible, text, ariaLabel });
  }

  const messageDiagnostics = [];
  for (const selector of messageCandidates) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    const first = locator.first();
    const visible =
      count > 0 ? await first.isVisible().catch(() => false) : false;
    const text =
      count > 0
        ? ((await first.textContent().catch(() => "")) ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120)
        : "";

    messageDiagnostics.push({ selector, count, visible, text });
  }

  const sendButtonDiagnostics = [];
  for (const selector of sendButtonCandidates) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    const first = locator.first();
    const visible =
      count > 0 ? await first.isVisible().catch(() => false) : false;
    const text =
      count > 0
        ? ((await first.textContent().catch(() => "")) ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120)
        : "";
    const ariaLabel =
      count > 0
        ? await first.getAttribute("aria-label").catch(() => null)
        : null;

    sendButtonDiagnostics.push({ selector, count, visible, text, ariaLabel });
  }

  const pageSnapshot = await page.evaluate(() => {
    const activeElement = document.activeElement;
    return {
      activeTag: activeElement?.tagName ?? null,
      activeAriaLabel: activeElement?.getAttribute("aria-label") ?? null,
      activeRole: activeElement?.getAttribute("role") ?? null,
      editableCount: document.querySelectorAll('[contenteditable="true"]')
        .length,
      textboxCount: document.querySelectorAll('[role="textbox"]').length,
    };
  });

  return {
    composerDiagnostics,
    messageDiagnostics,
    sendButtonDiagnostics,
    pageSnapshot,
  };
}

function createProbeMessage() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `probe:${nonce}`;
}

async function getVisibleMessageContainerCount(page) {
  return page
    .locator('[data-qa="message_container"]')
    .count()
    .catch(() => 0);
}

async function sendProbeMessage(page, message) {
  const composer = page.locator('[role="textbox"][aria-label*="Message to"]');
  await composer.waitFor({ state: "visible", timeout: 15000 });
  await composer.click();
  await page.keyboard.press("Meta+A").catch(() => {});
  await page.keyboard.insertText(message);

  const sendButton = page.locator(
    'button[data-qa="texty_send_button"], button[aria-label*="Send"], button[aria-label*="发送"]',
  );
  const sendButtonVisible = await sendButton
    .first()
    .isVisible()
    .catch(() => false);

  if (sendButtonVisible) {
    await sendButton.first().click();
    return;
  }

  await page.keyboard.press("Enter");
}

async function waitForOwnMessage(page, message, timeoutMs) {
  const ownMessage = page.locator('[data-qa="message_content"]', {
    hasText: message,
  });
  await ownMessage.first().waitFor({ state: "visible", timeout: timeoutMs });

  const messageContainers = page.locator('[data-qa="message_container"]');
  const count = await messageContainers.count().catch(() => 0);
  const lastMessageText =
    count > 0
      ? (
          (await messageContainers
            .nth(count - 1)
            .textContent()
            .catch(() => "")) ?? ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 240)
      : "";

  return { count, lastMessageText };
}

async function waitForReplyAfterOwnMessage(
  page,
  ownMessageCount,
  ownLastMessageText,
  ownMessage,
  timeoutMs,
) {
  const messageContainers = page.locator('[data-qa="message_container"]');
  await page.waitForFunction(
    ({ selector, count, lastMessageText, sentMessage }) => {
      const nodes = Array.from(document.querySelectorAll(selector));
      const currentLastText =
        nodes.at(-1)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

      return (
        (nodes.length > count || currentLastText !== lastMessageText) &&
        currentLastText.length > 0 &&
        !currentLastText.includes(sentMessage)
      );
    },
    {
      selector: '[data-qa="message_container"]',
      count: ownMessageCount,
      lastMessageText: ownLastMessageText,
      sentMessage: ownMessage,
    },
    { timeout: timeoutMs },
  );

  const afterCount = await messageContainers.count();
  const lastMessage = messageContainers.nth(afterCount - 1);
  const text = ((await lastMessage.textContent().catch(() => "")) ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

  return { afterCount, text };
}

async function openBrowserTarget(options) {
  if (options.connectUrl) {
    const browser = await chromium.connectOverCDP(options.connectUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const existingPages = context.pages();
    const matchingPage = existingPages.find(
      (page) =>
        page.url().startsWith(options.slackUrl) ||
        page.url().startsWith("https://app.slack.com/client/"),
    );
    const page = matchingPage ?? existingPages[0] ?? (await context.newPage());

    return {
      page,
      close: async () => {},
    };
  }

  const context = await chromium.launchPersistentContext(options.profileDir, {
    channel: browserChannel,
    headless: options.headless,
    viewport: { width: 1440, height: 960 },
  });
  const page = context.pages()[0] ?? (await context.newPage());

  return {
    page,
    close: async () => {
      await context.close();
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === "help") {
    printUsage();
    return;
  }

  if (!options.slackUrl) {
    throw new Error("missing required --url <slack-dm-url>");
  }

  const prepareUrl = options.prepareUrl ?? buildPrepareUrl(options.slackUrl);

  await ensureProfileDirectory(options.profileDir, options.resetProfile);

  console.log(`[probe] mode=${options.mode}`);
  console.log(`[probe] browserChannel=${browserChannel}`);
  console.log(`[probe] connectUrl=${options.connectUrl ?? "none"}`);
  console.log(`[probe] profileDir=${options.profileDir}`);
  console.log(`[probe] targetUrl=${options.slackUrl}`);
  console.log(`[probe] prepareUrl=${prepareUrl}`);
  console.log(`[probe] headless=${formatBoolean(options.headless)}`);
  console.log(`[probe] resetProfile=${formatBoolean(options.resetProfile)}`);

  const target = await openBrowserTarget(options);

  try {
    const { page } = target;

    if (options.mode === "prepare") {
      if (options.headless) {
        throw new Error("prepare mode requires a visible browser window");
      }

      console.log(
        "[probe] opening Slack sign-in. Complete login in the browser window. The probe will confirm when the session becomes reusable.",
      );
      await openPreparePage(page, prepareUrl, options.timeoutMs);

      const preparedSession = await waitForReusableSession(
        page,
        options.slackUrl,
        options.prepareTimeoutMs,
      );

      if (!preparedSession) {
        console.log(
          "[probe] timed out while waiting for a reusable Slack session.",
        );
        process.exitCode = 2;
        return;
      }

      console.log(`[probe] currentUrl=${preparedSession.currentUrl}`);
      console.log(
        "[probe] Slack session is now saved in the persistent profile.",
      );
      return;
    }

    const currentPageAlreadyOnSlack =
      page.url().startsWith(options.slackUrl) ||
      page.url().startsWith("https://app.slack.com/client/");
    const session = await detectSession(
      page,
      currentPageAlreadyOnSlack ? page.url() : options.slackUrl,
      options.timeoutMs,
    );

    console.log(`[probe] currentUrl=${session.currentUrl}`);
    console.log(`[probe] title=${session.title}`);
    console.log(
      `[probe] authenticated=${formatBoolean(session.looksAuthenticated)}`,
    );
    console.log(
      `[probe] redirectedToSignIn=${formatBoolean(session.redirectedToSignIn)}`,
    );
    console.log(
      `[probe] loadErrorVisible=${formatBoolean(session.loadErrorVisible)}`,
    );
    console.log(
      `[probe] composerVisible=${formatBoolean(session.composerVisible)}`,
    );
    console.log(
      `[probe] workspaceShellVisible=${formatBoolean(session.workspaceShellVisible)}`,
    );

    if (session.bodyPreview.length > 0) {
      console.log(`[probe] bodyPreview=${session.bodyPreview}`);
    }

    if (!session.looksAuthenticated) {
      console.log(
        "[probe] login state is not ready. Run `pnpm probe:slack -- prepare`, complete Slack login in the opened browser, and wait for the session-ready message.",
      );
      console.log("[probe] result=not-ready");
      process.exitCode = 2;
      return;
    }

    if (options.mode === "session") {
      console.log("[probe] saved Slack browser session looks reusable.");
      return;
    }

    if (options.mode === "inspect") {
      const diagnostics = await inspectSlackDm(page);
      console.log(
        `[probe] pageSnapshot=${JSON.stringify(diagnostics.pageSnapshot)}`,
      );
      console.log(
        `[probe] composerDiagnostics=${JSON.stringify(diagnostics.composerDiagnostics)}`,
      );
      console.log(
        `[probe] messageDiagnostics=${JSON.stringify(diagnostics.messageDiagnostics)}`,
      );
      console.log(
        `[probe] sendButtonDiagnostics=${JSON.stringify(diagnostics.sendButtonDiagnostics)}`,
      );
      return;
    }

    if (options.mode === "send") {
      const message = options.message ?? createProbeMessage();
      const beforeCount = await getVisibleMessageContainerCount(page);

      console.log(`[probe] sendMessage=${message}`);
      console.log(`[probe] messageCountBefore=${beforeCount}`);

      await sendProbeMessage(page, message);
      const ownMessageState = await waitForOwnMessage(page, message, 15000);
      console.log(`[probe] ownMessageCount=${ownMessageState.count}`);
      console.log(`[probe] ownLastMessage=${ownMessageState.lastMessageText}`);

      const reply = await waitForReplyAfterOwnMessage(
        page,
        ownMessageState.count,
        ownMessageState.lastMessageText,
        message,
        options.replyTimeoutMs,
      );
      console.log(`[probe] messageCountAfter=${reply.afterCount}`);
      console.log(`[probe] latestMessage=${reply.text}`);
      console.log("[probe] result=pass");
      console.log(
        "[probe] observed a new Slack reply after sending the probe.",
      );
      return;
    }

    console.log(
      "[probe] Slack session looks reusable. The browser will stay open until you close it.",
    );
    await page.bringToFront();
    await page.waitForTimeout(Number.POSITIVE_INFINITY);
  } finally {
    await target.close();
  }
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    console.error("[probe] failed to launch Slack probe");
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    console.error("[probe] result=fail");
    process.exit(1);
  });
