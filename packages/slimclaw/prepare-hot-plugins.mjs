import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, "..", "..");
const FEISHU_STARTUP_EXPERIMENT_MODE =
  process.env.NEXU_SLIMCLAW_FEISHU_STARTUP_EXPERIMENT;

function buildFeishuMinimalStartupEntrySource() {
  return `import {
  buildProbeChannelStatusSummary,
  buildRuntimeAccountStatusSnapshot,
  createDefaultChannelRuntimeState,
  DEFAULT_ACCOUNT_ID,
  PAIRING_APPROVED_MESSAGE,
  emptyPluginConfigSchema,
} from "openclaw/plugin-sdk/feishu";
import {
  collectAllowlistProviderRestrictSendersWarnings,
  formatAllowFromLowercase,
  mapAllowFromEntries,
} from "openclaw/plugin-sdk/compat";
import { registerFeishuBitableTools } from "./src/bitable.js";
import { registerFeishuChatTools } from "./src/chat.js";
import { registerFeishuDocTools } from "./src/docx.js";
import { registerFeishuDriveTools } from "./src/drive.js";
import { registerFeishuPermTools } from "./src/perm.js";
import {
  listFeishuAccountIds,
  resolveDefaultFeishuAccountId,
  resolveFeishuAccount,
} from "./src/accounts.js";
import { resolveFeishuGroupToolPolicy } from "./src/policy.js";
import { setFeishuRuntime } from "./src/runtime.js";
import {
  looksLikeFeishuId,
  normalizeFeishuTarget,
} from "./src/targets.js";
import { registerFeishuWikiTools } from "./src/wiki.js";

const secretInputJsonSchema = {
  oneOf: [
    { type: "string" },
    {
      type: "object",
      additionalProperties: false,
      required: ["source", "provider", "id"],
      properties: {
        source: { type: "string", enum: ["env", "file", "exec"] },
        provider: { type: "string", minLength: 1 },
        id: { type: "string", minLength: 1 },
      },
    },
  ],
};

function setFeishuNamedAccountEnabled(cfg, accountId, enabled) {
  const feishuCfg = cfg.channels?.feishu;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      feishu: {
        ...feishuCfg,
        accounts: {
          ...feishuCfg?.accounts,
          [accountId]: {
            ...feishuCfg?.accounts?.[accountId],
            enabled,
          },
        },
      },
    },
  };
}

let feishuDirectoryModulePromise;
let feishuOutboundModulePromise;
let feishuProbeModulePromise;
let feishuSendModulePromise;
let feishuOnboardingModulePromise;
let feishuMonitorModulePromise;

function loadFeishuDirectoryModule() {
  feishuDirectoryModulePromise ??= import("./src/directory.js");
  return feishuDirectoryModulePromise;
}

function loadFeishuOutboundModule() {
  feishuOutboundModulePromise ??= import("./src/outbound.js");
  return feishuOutboundModulePromise;
}

function loadFeishuProbeModule() {
  feishuProbeModulePromise ??= import("./src/probe.js");
  return feishuProbeModulePromise;
}

function loadFeishuSendModule() {
  feishuSendModulePromise ??= import("./src/send.js");
  return feishuSendModulePromise;
}

function loadFeishuOnboardingModule() {
  feishuOnboardingModulePromise ??= import("./src/onboarding.js");
  return feishuOnboardingModulePromise;
}

function loadFeishuMonitorModule() {
  feishuMonitorModulePromise ??= import("./src/monitor.js");
  return feishuMonitorModulePromise;
}

const feishuPlugin = {
  id: "feishu",
  meta: {
    id: "feishu",
    label: "Feishu",
    selectionLabel: "Feishu/Lark (飞书)",
    docsPath: "/channels/feishu",
    docsLabel: "feishu",
    blurb: "飞书/Lark enterprise messaging.",
    aliases: ["lark"],
    order: 70,
  },
  capabilities: {
    chatTypes: ["direct", "channel"],
    polls: false,
    threads: true,
    media: true,
    reactions: true,
    edit: true,
    reply: true,
  },
  pairing: {
    idLabel: "feishuUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(feishu|user|open_id):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const { sendMessageFeishu } = await loadFeishuSendModule();
      await sendMessageFeishu({
        cfg,
        to: id,
        text: PAIRING_APPROVED_MESSAGE,
      });
    },
  },
  agentPrompt: {
    messageToolHints: () => [
      "- Feishu targeting: omit \`target\` to reply to the current conversation (auto-inferred). Explicit targets: \`user:open_id\` or \`chat:chat_id\`.",
      "- Feishu supports interactive cards for rich messages.",
    ],
  },
  groups: {
    resolveToolPolicy: resolveFeishuGroupToolPolicy,
  },
  mentions: {
    stripPatterns: () => ['<at user_id="[^"]*">[^<]*</at>'],
  },
  reload: { configPrefixes: ["channels.feishu"] },
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        defaultAccount: { type: "string" },
        appId: { type: "string" },
        appSecret: secretInputJsonSchema,
        encryptKey: { type: "string" },
        verificationToken: secretInputJsonSchema,
        domain: {
          oneOf: [
            { type: "string", enum: ["feishu", "lark"] },
            { type: "string", format: "uri", pattern: "^https://" },
          ],
        },
        connectionMode: { type: "string", enum: ["websocket", "webhook"] },
        webhookPath: { type: "string" },
        webhookHost: { type: "string" },
        webhookPort: { type: "integer", minimum: 1 },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
        allowFrom: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
        groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
        groupAllowFrom: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "number" }] },
        },
        requireMention: { type: "boolean" },
        groupSessionScope: {
          type: "string",
          enum: ["group", "group_sender", "group_topic", "group_topic_sender"],
        },
        topicSessionMode: { type: "string", enum: ["disabled", "enabled"] },
        replyInThread: { type: "string", enum: ["disabled", "enabled"] },
        historyLimit: { type: "integer", minimum: 0 },
        dmHistoryLimit: { type: "integer", minimum: 0 },
        textChunkLimit: { type: "integer", minimum: 1 },
        chunkMode: { type: "string", enum: ["length", "newline"] },
        mediaMaxMb: { type: "number", minimum: 0 },
        renderMode: { type: "string", enum: ["auto", "raw", "card"] },
        accounts: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              name: { type: "string" },
              appId: { type: "string" },
              appSecret: secretInputJsonSchema,
              encryptKey: { type: "string" },
              verificationToken: secretInputJsonSchema,
              domain: { type: "string", enum: ["feishu", "lark"] },
              connectionMode: { type: "string", enum: ["websocket", "webhook"] },
              webhookHost: { type: "string" },
              webhookPath: { type: "string" },
              webhookPort: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
  },
  config: {
    listAccountIds: (cfg) => listFeishuAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveFeishuAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultFeishuAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const account = resolveFeishuAccount({ cfg, accountId });
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;
      if (isDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            feishu: {
              ...cfg.channels?.feishu,
              enabled,
            },
          },
        };
      }

      return setFeishuNamedAccountEnabled(cfg, account.accountId, enabled);
    },
    deleteAccount: ({ cfg, accountId }) => {
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;
      if (isDefault) {
        const next = { ...cfg };
        const nextChannels = { ...cfg.channels };
        delete nextChannels.feishu;
        if (Object.keys(nextChannels).length > 0) {
          next.channels = nextChannels;
        } else {
          delete next.channels;
        }
        return next;
      }

      const feishuCfg = cfg.channels?.feishu;
      const accounts = { ...feishuCfg?.accounts };
      delete accounts[accountId];
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          feishu: {
            ...feishuCfg,
            accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
          },
        },
      };
    },
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      appId: account.appId,
      domain: account.domain,
    }),
    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveFeishuAccount({ cfg, accountId });
      return mapAllowFromEntries(account.config?.allowFrom);
    },
    formatAllowFrom: ({ allowFrom }) => formatAllowFromLowercase({ allowFrom }),
  },
  security: {
    collectWarnings: ({ cfg, accountId }) => {
      const account = resolveFeishuAccount({ cfg, accountId });
      const feishuCfg = account.config;
      return collectAllowlistProviderRestrictSendersWarnings({
        cfg,
        providerConfigPresent: cfg.channels?.feishu !== undefined,
        configuredGroupPolicy: feishuCfg?.groupPolicy,
        surface: "Feishu[" + account.accountId + "] groups",
        openScope: "any member",
        groupPolicyPath: "channels.feishu.groupPolicy",
        groupAllowFromPath: "channels.feishu.groupAllowFrom",
      });
    },
  },
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg, accountId }) => {
      const isDefault = !accountId || accountId === DEFAULT_ACCOUNT_ID;
      if (isDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            feishu: {
              ...cfg.channels?.feishu,
              enabled: true,
            },
          },
        };
      }

      return setFeishuNamedAccountEnabled(cfg, accountId, true);
    },
  },
  onboarding: {
    channel: "feishu",
    getStatus: async (params) => {
      const { feishuOnboardingAdapter } = await loadFeishuOnboardingModule();
      return feishuOnboardingAdapter.getStatus(params);
    },
    configure: async (params) => {
      const { feishuOnboardingAdapter } = await loadFeishuOnboardingModule();
      return feishuOnboardingAdapter.configure(params);
    },
    disable: (cfg) => ({
      ...cfg,
      channels: {
        ...cfg.channels,
        feishu: { ...cfg.channels?.feishu, enabled: false },
      },
    }),
  },
  messaging: {
    normalizeTarget: (raw) => normalizeFeishuTarget(raw) ?? undefined,
    targetResolver: {
      looksLikeId: looksLikeFeishuId,
      hint: "<chatId|user:openId|chat:chatId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, query, limit, accountId }) => {
      const { listFeishuDirectoryPeers } = await loadFeishuDirectoryModule();
      return listFeishuDirectoryPeers({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      });
    },
    listGroups: async ({ cfg, query, limit, accountId }) => {
      const { listFeishuDirectoryGroups } = await loadFeishuDirectoryModule();
      return listFeishuDirectoryGroups({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      });
    },
    listPeersLive: async ({ cfg, query, limit, accountId }) => {
      const { listFeishuDirectoryPeersLive } = await loadFeishuDirectoryModule();
      return listFeishuDirectoryPeersLive({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      });
    },
    listGroupsLive: async ({ cfg, query, limit, accountId }) => {
      const { listFeishuDirectoryGroupsLive } = await loadFeishuDirectoryModule();
      return listFeishuDirectoryGroupsLive({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      });
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => apiRuntime.channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 4000,
    sendText: async (params) => {
      const { feishuOutbound } = await loadFeishuOutboundModule();
      return feishuOutbound.sendText(params);
    },
    sendMedia: async (params) => {
      const { feishuOutbound } = await loadFeishuOutboundModule();
      return feishuOutbound.sendMedia(params);
    },
  },
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID, { port: null }),
    buildChannelSummary: ({ snapshot }) =>
      buildProbeChannelStatusSummary(snapshot, {
        port: snapshot.port ?? null,
      }),
    probeAccount: async ({ account }) => {
      const { probeFeishu } = await loadFeishuProbeModule();
      return probeFeishu(account);
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      appId: account.appId,
      domain: account.domain,
      ...buildRuntimeAccountStatusSnapshot({ runtime, probe }),
      port: runtime?.port ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = resolveFeishuAccount({ cfg: ctx.cfg, accountId: ctx.accountId });
      const port = account.config?.webhookPort ?? null;
      ctx.setStatus({ accountId: ctx.accountId, port });
      ctx.log?.info(
        "starting feishu[" +
          ctx.accountId +
          "] (mode: " +
          (account.config?.connectionMode ?? "websocket") +
          ")",
      );
      const { monitorFeishuProvider } = await loadFeishuMonitorModule();
      return monitorFeishuProvider({
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        accountId: ctx.accountId,
      });
    },
  },
};

let apiRuntime = null;

const plugin = {
  id: "feishu",
  name: "Feishu",
  description: "Feishu/Lark channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api) {
    apiRuntime = api.runtime;
    setFeishuRuntime(api.runtime);
    api.registerChannel({ plugin: feishuPlugin });
    registerFeishuDocTools(api);
    registerFeishuChatTools(api);
    registerFeishuWikiTools(api);
    registerFeishuDriveTools(api);
    registerFeishuPermTools(api);
    registerFeishuBitableTools(api);
  },
};

export { feishuPlugin };
export default plugin;
`;
}

async function walkTypescriptFiles(rootDir, currentDir = rootDir, files = []) {
  const entries = await readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules") {
      continue;
    }

    const entryPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await walkTypescriptFiles(rootDir, entryPath, files);
      continue;
    }

    if (
      !entry.isFile() ||
      !entry.name.endsWith(".ts") ||
      entry.name.endsWith(".d.ts")
    ) {
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

function transpileTsToJs(sourceText, sourcePath) {
  return ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      verbatimModuleSyntax: true,
      isolatedModules: true,
    },
    fileName: sourcePath,
    reportDiagnostics: false,
  }).outputText;
}

export async function precompileFeishuPlugin(runtimeDir) {
  const feishuRoot = path.join(
    runtimeDir,
    "node_modules",
    "openclaw",
    "extensions",
    "feishu",
  );
  const packageJsonPath = path.join(feishuRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));

  if (!Array.isArray(packageJson.openclaw?.extensions)) {
    throw new Error("feishu package.json is missing openclaw.extensions");
  }

  const tsFiles = await walkTypescriptFiles(feishuRoot);
  let transpiledCount = 0;

  for (const tsFilePath of tsFiles) {
    const sourceText = await readFile(tsFilePath, "utf8");
    const jsOutputPath = tsFilePath.replace(/\.ts$/u, ".js");
    const jsOutput = transpileTsToJs(sourceText, tsFilePath);
    await writeFile(jsOutputPath, jsOutput, "utf8");
    transpiledCount += 1;
  }

  let entryPath = "./index.js";
  let startupExperimentMode = null;

  if (FEISHU_STARTUP_EXPERIMENT_MODE === "minimal-entry") {
    const experimentalEntryPath = path.join(
      feishuRoot,
      "slimclaw-startup-entry.js",
    );
    await writeFile(
      experimentalEntryPath,
      buildFeishuMinimalStartupEntrySource(),
      "utf8",
    );
    entryPath = "./slimclaw-startup-entry.js";
    startupExperimentMode = FEISHU_STARTUP_EXPERIMENT_MODE;
  }

  packageJson.openclaw.extensions = packageJson.openclaw.extensions.map(
    (entry) => (entry === "./index.ts" ? entryPath : entry),
  );
  await writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
    "utf8",
  );

  return {
    pluginId: "feishu",
    transpiledCount,
    packageJsonPath,
    startupExperimentMode,
  };
}

async function transpilePluginTypescriptTree(sourceRoot, targetRoot) {
  const tsFiles = await walkTypescriptFiles(sourceRoot);
  let transpiledCount = 0;

  for (const tsFilePath of tsFiles) {
    const sourceText = await readFile(tsFilePath, "utf8");
    const relativePath = path.relative(sourceRoot, tsFilePath);
    const jsOutputPath = path
      .join(targetRoot, relativePath)
      .replace(/\.ts$/u, ".js");
    const jsOutput = transpileTsToJs(sourceText, tsFilePath);
    await mkdir(path.dirname(jsOutputPath), { recursive: true });
    await writeFile(jsOutputPath, jsOutput, "utf8");
    transpiledCount += 1;
  }

  return transpiledCount;
}

function rewriteWeixinRuntimePackage(sourcePackageJson) {
  const { devDependencies: _devDependencies, ...runtimePackageJson } = {
    ...sourcePackageJson,
    openclaw: {
      ...sourcePackageJson.openclaw,
      extensions: Array.isArray(sourcePackageJson.openclaw?.extensions)
        ? sourcePackageJson.openclaw.extensions.map((entry) =>
            entry === "./index.ts"
              ? "./index.js"
              : entry.replace(/\.ts$/u, ".js"),
          )
        : sourcePackageJson.openclaw?.extensions,
    },
  };
  return runtimePackageJson;
}

export async function prepareBuiltinWeixinPlugin(runtimeDir) {
  const sourceRoot = path.join(
    repoRoot,
    "packages",
    "slimclaw",
    "runtime-plugins",
    "openclaw-weixin",
  );
  const targetRoot = path.join(
    runtimeDir,
    "node_modules",
    "openclaw",
    "extensions",
    "openclaw-weixin",
  );
  const sourcePackageJsonPath = path.join(sourceRoot, "package.json");
  const targetPackageJsonPath = path.join(targetRoot, "package.json");
  const runtimeDependencyPaths = [
    path.join(runtimeDir, "node_modules", "qrcode-terminal", "package.json"),
    path.join(runtimeDir, "node_modules", "zod", "package.json"),
  ];
  const sourcePackageJson = JSON.parse(
    await readFile(sourcePackageJsonPath, "utf8"),
  );

  for (const runtimeDependencyPath of runtimeDependencyPaths) {
    await readFile(runtimeDependencyPath, "utf8");
  }

  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });

  const transpiledCount = await transpilePluginTypescriptTree(
    sourceRoot,
    targetRoot,
  );

  await writeFile(
    targetPackageJsonPath,
    `${JSON.stringify(rewriteWeixinRuntimePackage(sourcePackageJson), null, 2)}\n`,
    "utf8",
  );

  await cp(
    path.join(sourceRoot, "openclaw.plugin.json"),
    path.join(targetRoot, "openclaw.plugin.json"),
    {
      force: true,
    },
  );

  return {
    pluginId: "openclaw-weixin",
    transpiledCount,
    packageJsonPath: targetPackageJsonPath,
  };
}
