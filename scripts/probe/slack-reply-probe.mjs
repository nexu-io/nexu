import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
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
  "chrome-canary-profile",
);
const defaultCanaryBinary =
  process.env.SLACK_PROBE_CANARY_BIN ??
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary";
const defaultSlackUrl = process.env.PROBE_SLACK_URL ?? null;
const defaultConnectUrl = "http://127.0.0.1:9222";
const defaultReplyTimeoutMs = Number(
  process.env.SLACK_PROBE_REPLY_TIMEOUT_MS ?? "90000",
);
const defaultPageTimeoutMs = Number(
  process.env.SLACK_PROBE_TIMEOUT_MS ?? "15000",
);

function parseArgs(argv) {
  const options = {
    mode: "help",
    slackUrl: defaultSlackUrl,
    connectUrl: defaultConnectUrl,
    profileDir: defaultProfileDir,
    canaryBinary: defaultCanaryBinary,
    debugPort: 9222,
    replyTimeoutMs: defaultReplyTimeoutMs,
    pageTimeoutMs: defaultPageTimeoutMs,
    message: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (
      arg === "prepare" ||
      arg === "run" ||
      arg === "inspect" ||
      arg === "session"
    ) {
      options.mode = arg;
      continue;
    }

    if (arg === "--url") {
      options.slackUrl = argv[index + 1] ?? options.slackUrl;
      index += 1;
      continue;
    }

    if (arg === "--connect-url") {
      options.connectUrl = argv[index + 1] ?? options.connectUrl;
      index += 1;
      continue;
    }

    if (arg === "--profile-dir") {
      options.profileDir = path.resolve(argv[index + 1] ?? options.profileDir);
      index += 1;
      continue;
    }

    if (arg === "--canary-binary") {
      options.canaryBinary = argv[index + 1] ?? options.canaryBinary;
      index += 1;
      continue;
    }

    if (arg === "--debug-port") {
      const nextValue = Number(argv[index + 1] ?? options.debugPort);
      if (!Number.isNaN(nextValue) && nextValue > 0) {
        options.debugPort = nextValue;
        options.connectUrl = `http://127.0.0.1:${nextValue}`;
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

    if (arg === "--timeout-ms") {
      const nextValue = Number(argv[index + 1] ?? options.pageTimeoutMs);
      if (!Number.isNaN(nextValue) && nextValue > 0) {
        options.pageTimeoutMs = nextValue;
      }
      index += 1;
      continue;
    }

    if (arg === "--message") {
      options.message = argv[index + 1] ?? options.message;
      index += 1;
      continue;
    }

    if (arg === "--help" || arg === "-h" || arg === "help") {
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
      '  export PROBE_SLACK_URL="https://app.slack.com/client/..."',
      "  pnpm probe:slack prepare",
      "  pnpm probe:slack run",
      "",
      "Commands:",
      "  prepare           Launch Chrome Canary with a dedicated probe profile",
      "  run               Send one probe message and wait for a new reply",
      "  session           Check whether the Slack page looks ready",
      "  inspect           Print selector diagnostics for the current DM page",
      "",
      "Options:",
      "  --url             Override PROBE_SLACK_URL for this run",
      "  --connect-url     Override the Chrome CDP endpoint (default: http://127.0.0.1:9222)",
      "  --debug-port      Debug port used by `prepare` (default: 9222)",
      "  --profile-dir     Override the dedicated Canary profile directory",
      "  --canary-binary   Override the Chrome Canary executable path",
      "  --reply-timeout-ms Override reply wait timeout in milliseconds",
      "  --timeout-ms      Override page navigation timeout in milliseconds",
      "  --message         Override the sent probe message body",
    ].join("\n"),
  );
}

function requireSlackUrl(slackUrl) {
  if (!slackUrl) {
    throw new Error(
      "missing Slack DM URL: export PROBE_SLACK_URL or pass --url",
    );
  }
}

function createProbeMessage() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `probe:${nonce}`;
}

function formatBoolean(value) {
  return value ? "yes" : "no";
}

function logInfo(message) {
  console.log(`[probe][info] ${message}`);
}

function logDebug(message) {
  console.log(`[probe][debug] ${message}`);
}

function logError(message) {
  console.error(`[probe][error] ${message}`);
}

function printResult(status, message) {
  const normalizedStatus = status.toUpperCase();
  logInfo(`result=${status}`);
  logInfo(`===== ${normalizedStatus} =====`);
  if (message) {
    logInfo(message);
  }
}

async function launchProbeBrowser(options) {
  requireSlackUrl(options.slackUrl);

  if (!existsSync(options.canaryBinary)) {
    throw new Error(
      `chrome canary binary not found at ${options.canaryBinary}`,
    );
  }

  await mkdir(options.profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${options.debugPort}`,
    `--user-data-dir=${options.profileDir}`,
    "--new-window",
    options.slackUrl,
  ];

  const child = spawn(options.canaryBinary, args, {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  logInfo("mode=prepare");
  logDebug(`canaryBinary=${options.canaryBinary}`);
  logDebug(`profileDir=${options.profileDir}`);
  logDebug(`connectUrl=${options.connectUrl}`);
  logInfo(`targetUrl=${options.slackUrl}`);
  logInfo("Chrome Canary launched.");
  logInfo(
    "If this is the first run, log into Slack in that Canary window, then rerun `pnpm probe:slack run`.",
  );
}

async function openBrowserTarget(connectUrl, slackUrl) {
  const browser = await chromium.connectOverCDP(connectUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const existingPages = context.pages();
  const matchingPage = existingPages.find(
    (page) =>
      page.url().startsWith(slackUrl) ||
      page.url().startsWith("https://app.slack.com/client/"),
  );
  const page = matchingPage ?? existingPages[0] ?? (await context.newPage());

  return {
    page,
    close: async () => {},
  };
}

async function detectSession(page, expectedUrl, timeoutMs) {
  const currentUrlBefore = page.url();
  const shouldNavigate =
    !currentUrlBefore.startsWith(expectedUrl) &&
    !currentUrlBefore.startsWith("https://app.slack.com/client/");

  if (shouldNavigate) {
    await page.goto(expectedUrl, {
      timeout: timeoutMs,
      waitUntil: "domcontentloaded",
    });
  }

  await page.waitForTimeout(2000);

  const currentUrl = page.url();
  const bodyText = (await page.locator("body").textContent()) ?? "";
  const normalizedText = bodyText.replace(/\s+/g, " ").trim();
  const title = await page.title().catch(() => "");
  const redirectedToSignIn =
    currentUrl.includes("/signin") ||
    currentUrl.includes("/checkcookie") ||
    currentUrl.includes("/ssb/signin") ||
    currentUrl.includes("/workspace-signin");

  const composerVisible = await page
    .locator('[role="textbox"][aria-label*="Message to"]')
    .first()
    .isVisible()
    .catch(() => false);

  const workspaceShellVisible = await page
    .locator('[data-qa="message_input"], [data-qa="message_container"]')
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

  return {
    looksAuthenticated:
      !redirectedToSignIn &&
      !loadErrorVisible &&
      (composerVisible || workspaceShellVisible),
    currentUrl,
    title,
    redirectedToSignIn,
    loadErrorVisible,
    composerVisible,
    workspaceShellVisible,
    bodyPreview: normalizedText.slice(0, 280),
  };
}

async function inspectSlackDm(page) {
  const selectorGroups = {
    composer: [
      '[data-qa="message_input"]',
      '[data-qa="message_input"] [contenteditable="true"]',
      '[role="textbox"]',
      '[contenteditable="true"]',
      'div[aria-label*="Message"]',
      'div[data-qa="message_input"] div[contenteditable="true"]',
    ],
    messages: [
      '[data-qa="virtual-list-item"]',
      '[data-qa="message_container"]',
      '[data-qa="message_content"]',
      '[role="listitem"]',
    ],
    sendButtons: [
      'button[aria-label*="Send"]',
      'button[data-qa="texty_send_button"]',
      'button[aria-label*="发送"]',
    ],
  };

  async function collect(selectors) {
    const results = [];
    for (const selector of selectors) {
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

      results.push({ selector, count, visible, text, ariaLabel });
    }
    return results;
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
    pageSnapshot,
    composerDiagnostics: await collect(selectorGroups.composer),
    messageDiagnostics: await collect(selectorGroups.messages),
    sendButtonDiagnostics: await collect(selectorGroups.sendButtons),
  };
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
  const lastMessage = messageContainers.nth(Math.max(afterCount - 1, 0));
  const text = ((await lastMessage.textContent().catch(() => "")) ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);

  return { afterCount, text };
}

async function withConnectedPage(options, fn) {
  requireSlackUrl(options.slackUrl);

  const target = await openBrowserTarget(options.connectUrl, options.slackUrl);

  try {
    const session = await detectSession(
      target.page,
      options.slackUrl,
      options.pageTimeoutMs,
    );

    logInfo(`mode=${options.mode}`);
    logInfo(`targetUrl=${options.slackUrl}`);
    logDebug(`connectUrl=${options.connectUrl}`);
    logDebug(`profileDir=${options.profileDir}`);
    logDebug(`currentUrl=${session.currentUrl}`);
    logDebug(`title=${session.title}`);
    logDebug(`authenticated=${formatBoolean(session.looksAuthenticated)}`);
    logDebug(`redirectedToSignIn=${formatBoolean(session.redirectedToSignIn)}`);
    logDebug(`loadErrorVisible=${formatBoolean(session.loadErrorVisible)}`);
    logDebug(`composerVisible=${formatBoolean(session.composerVisible)}`);
    logDebug(
      `workspaceShellVisible=${formatBoolean(session.workspaceShellVisible)}`,
    );

    if (!session.looksAuthenticated && session.bodyPreview.length > 0) {
      logDebug(`bodyPreview=${session.bodyPreview}`);
    }

    if (!session.looksAuthenticated) {
      printResult(
        "not-ready",
        "Slack is not ready in Chrome Canary. Run `pnpm probe:slack prepare`, log into Slack in Canary if needed, then rerun.",
      );
      process.exitCode = 2;
      return;
    }

    await fn(target.page);
  } finally {
    await target.close();
  }
}

async function runProbe(options) {
  await withConnectedPage(options, async (page) => {
    const message = options.message ?? createProbeMessage();
    const beforeCount = await getVisibleMessageContainerCount(page);

    logInfo(`sendMessage=${message}`);
    logDebug(`messageCountBefore=${beforeCount}`);

    await sendProbeMessage(page, message);
    const ownMessageState = await waitForOwnMessage(page, message, 15000);

    logDebug(`ownMessageCount=${ownMessageState.count}`);
    logDebug(`ownLastMessage=${ownMessageState.lastMessageText}`);

    const reply = await waitForReplyAfterOwnMessage(
      page,
      ownMessageState.count,
      ownMessageState.lastMessageText,
      message,
      options.replyTimeoutMs,
    );

    logDebug(`messageCountAfter=${reply.afterCount}`);
    logInfo(`latestMessage=${reply.text}`);
    printResult("pass", "Observed a new Slack reply after sending the probe.");
  });
}

async function runSessionCheck(options) {
  await withConnectedPage(options, async () => {
    printResult("pass", "Slack page looks ready.");
  });
}

async function runInspect(options) {
  await withConnectedPage(options, async (page) => {
    const diagnostics = await inspectSlackDm(page);
    logDebug(`pageSnapshot=${JSON.stringify(diagnostics.pageSnapshot)}`);
    logDebug(
      `composerDiagnostics=${JSON.stringify(diagnostics.composerDiagnostics)}`,
    );
    logDebug(
      `messageDiagnostics=${JSON.stringify(diagnostics.messageDiagnostics)}`,
    );
    logDebug(
      `sendButtonDiagnostics=${JSON.stringify(diagnostics.sendButtonDiagnostics)}`,
    );
    printResult("pass", "Selector diagnostics collected.");
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.mode === "help") {
    printUsage();
    return;
  }

  if (options.mode === "prepare") {
    await launchProbeBrowser(options);
    return;
  }

  if (options.mode === "run") {
    await runProbe(options);
    return;
  }

  if (options.mode === "session") {
    await runSessionCheck(options);
    return;
  }

  if (options.mode === "inspect") {
    await runInspect(options);
  }
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    logError("failed");
    if (error instanceof Error) {
      logError(error.message);
    } else {
      logError(String(error));
    }
    logError("result=fail");
    logError("===== FAIL =====");
    process.exit(1);
  });
