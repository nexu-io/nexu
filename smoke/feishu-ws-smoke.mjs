import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getSlimclawRuntimeRoot } from "@nexu/slimclaw";

const smokeDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(smokeDir, "..");
const openclawRuntimeRoot = getSlimclawRuntimeRoot(repoRoot);
const desktopConfigPath = resolve(
  repoRoot,
  ".tmp/desktop/electron/user-data/runtime/openclaw/config/openclaw.json",
);

const requireFromRuntime = createRequire(
  resolve(openclawRuntimeRoot, "package.json"),
);
const Lark = requireFromRuntime("@larksuiteoapi/node-sdk");
const defaultDomain = Lark.Domain?.Feishu ?? "https://open.feishu.cn";

function timestamp() {
  return new Date().toISOString();
}

function log(level, message, details) {
  const prefix = `[${timestamp()}] [smoke:${level}] ${message}`;
  if (details === undefined) {
    console.log(prefix);
    return;
  }
  console.log(prefix, details);
}

function redactSecret(value) {
  if (!value) {
    return value;
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}***${value.slice(-1)}`;
  }

  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function summarizeUrl(url) {
  if (!url) {
    return { raw: url, valid: false };
  }

  try {
    const parsed = new URL(url);
    return {
      valid: true,
      protocol: parsed.protocol,
      host: parsed.host,
      pathname: parsed.pathname,
      hasDeviceId: parsed.searchParams.has("device_id"),
      hasServiceId: parsed.searchParams.has("service_id"),
      searchKeys: [...parsed.searchParams.keys()],
    };
  } catch (error) {
    return {
      valid: false,
      raw: url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseArgs(argv) {
  const options = {
    reply: false,
    accountId: process.env.FEISHU_ACCOUNT_ID,
    configPath: process.env.FEISHU_CONFIG_PATH ?? desktopConfigPath,
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
    domain: process.env.FEISHU_DOMAIN ?? defaultDomain,
  };

  function readNextValue(flag, index) {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--reply") {
      options.reply = true;
      continue;
    }
    if (arg === "--account") {
      options.accountId = readNextValue(arg, index);
      index += 1;
      continue;
    }
    if (arg === "--config") {
      options.configPath = readNextValue(arg, index);
      index += 1;
      continue;
    }
    if (arg === "--app-id") {
      options.appId = readNextValue(arg, index);
      index += 1;
      continue;
    }
    if (arg === "--app-secret") {
      options.appSecret = readNextValue(arg, index);
      index += 1;
      continue;
    }
    if (arg === "--domain") {
      options.domain = readNextValue(arg, index);
      index += 1;
    }
  }

  return options;
}

async function loadCredentials(options) {
  if (options.appId && options.appSecret) {
    return {
      accountId: options.accountId ?? options.appId,
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.domain,
      source: "env-or-cli",
    };
  }

  const rawConfig = await readFile(options.configPath, "utf8");
  const config = JSON.parse(rawConfig);
  const accounts = config?.channels?.feishu?.accounts ?? {};
  const accountId = options.accountId ?? Object.keys(accounts)[0];
  const account = accountId ? accounts[accountId] : null;

  if (!account?.appId || !account?.appSecret) {
    throw new Error(
      `Unable to resolve Feishu credentials from ${options.configPath}`,
    );
  }

  return {
    accountId,
    appId: account.appId,
    appSecret: account.appSecret,
    domain: account.domain ?? options.domain,
    source: options.configPath,
  };
}

function summarizeMessage(event) {
  const payload = event?.event ?? event;
  const header = event?.header ?? payload?.header;
  const message = payload?.message;
  const sender = payload?.sender;

  return {
    eventId: header?.event_id,
    eventType: header?.event_type,
    messageId: message?.message_id,
    chatId: message?.chat_id,
    chatType: message?.chat_type,
    messageType: message?.message_type,
    openId: sender?.sender_id?.open_id,
    text: (() => {
      try {
        const content = message?.content;
        return content ? JSON.parse(content).text : undefined;
      } catch {
        return message?.content;
      }
    })(),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const credentials = await loadCredentials(options);

  log("info", "starting Feishu websocket smoke", {
    accountId: credentials.accountId,
    appId: credentials.appId,
    domain: credentials.domain,
    reply: options.reply,
    source: credentials.source,
  });

  const logger = {
    trace: (...args) => log("trace", "sdk", args),
    debug: (...args) => log("debug", "sdk", args),
    info: (...args) => log("info", "sdk", args),
    warn: (...args) => log("warn", "sdk", args),
    error: (...args) => log("error", "sdk", args),
  };

  const debugHttpInstance = {
    request: async (requestConfig) => {
      if (String(requestConfig?.url).includes("/callback/ws/endpoint")) {
        log("info", "requesting ws endpoint", {
          url: requestConfig.url,
          domain: credentials.domain,
          appId: credentials.appId,
          appSecret: redactSecret(credentials.appSecret),
        });
      }

      const response = await Lark.defaultHttpInstance.request(requestConfig);

      if (String(requestConfig?.url).includes("/callback/ws/endpoint")) {
        log("info", "ws endpoint response", {
          code: response?.code,
          msg: response?.msg,
          urlSummary: summarizeUrl(response?.data?.URL),
          clientConfig: response?.data?.ClientConfig
            ? {
                pingInterval: response.data.ClientConfig.PingInterval,
                reconnectCount: response.data.ClientConfig.ReconnectCount,
                reconnectInterval: response.data.ClientConfig.ReconnectInterval,
                reconnectNonce: response.data.ClientConfig.ReconnectNonce,
              }
            : null,
        });
      }

      return response;
    },
  };

  const client = new Lark.Client({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    domain: credentials.domain,
    httpInstance: debugHttpInstance,
    logger,
    loggerLevel: Lark.LoggerLevel.info,
  });

  const wsClient = new Lark.WSClient({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    domain: credentials.domain,
    httpInstance: debugHttpInstance,
    logger,
    loggerLevel: Lark.LoggerLevel.info,
  });

  const eventDispatcher = new Lark.EventDispatcher({ logger }).register({
    "im.message.receive_v1": async (data) => {
      const summary = summarizeMessage(data);
      log("info", "received im.message.receive_v1", summary);

      if (!options.reply || !summary.chatId || !summary.text) {
        return;
      }

      await client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: summary.chatId,
          content: JSON.stringify({ text: `[smoke] ${summary.text}` }),
          msg_type: "text",
        },
      });

      log("info", "sent smoke reply", {
        chatId: summary.chatId,
        messageId: summary.messageId,
      });
    },
    "im.chat.access_event.bot_p2p_chat_entered_v1": async (data) => {
      log("info", "received bot_p2p_chat_entered", {
        eventId: data.header?.event_id,
        openId: data.event?.operator_id?.open_id,
      });
    },
    p2p_chat_create: async (data) => {
      log("info", "received p2p_chat_create", {
        eventId: data.header?.event_id,
        chatId: data.event?.chat_id,
      });
    },
    "im.chat.member.bot.added_v1": async (data) => {
      log("info", "received bot.added", {
        eventId: data.header?.event_id,
        chatId: data.event?.chat_id,
      });
    },
  });

  process.on("SIGINT", () => {
    log("info", "closing smoke websocket client");
    wsClient.close({ force: true });
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log("info", "closing smoke websocket client");
    wsClient.close({ force: true });
    process.exit(0);
  });

  await wsClient.start({ eventDispatcher });
  log("info", "smoke websocket client started; waiting for events");
}

await main();
