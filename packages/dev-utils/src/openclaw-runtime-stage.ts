import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";

const OPENCLAW_PACKAGE_PATCH_DIRNAME = "openclaw";
const STAGE_MANIFEST_FILENAME = "manifest.json";
const STAGE_PATCH_VERSION = "2026-03-29-runtime-stage-v1";
const REPLY_OUTCOME_HELPER_SEARCH = `
const sessionKey = ctx.SessionKey;
	const startTime = diagnosticsEnabled ? Date.now() : 0;
`.trim();
const REPLY_OUTCOME_HELPER_REPLACEMENT = `
const sessionKey = ctx.SessionKey;
	const emitReplyOutcome = (status, reasonCode, error) => {
		try {
			console.log("NEXU_EVENT channel.reply_outcome " + JSON.stringify({
				channel,
				status,
				reasonCode,
				accountId: ctx.AccountId,
				to: chatId,
				chatId,
				threadId: ctx.MessageThreadId,
				replyToMessageId: messageId,
				sessionKey,
				messageId,
				error,
				ts: (/* @__PURE__ */ new Date()).toISOString()
			}));
		} catch {}
	};
	const startTime = diagnosticsEnabled ? Date.now() : 0;
`.trim();
const REPLY_OUTCOME_SILENT_SEARCH = `
const counts = dispatcher.getQueuedCounts();
		counts.final += routedFinalCount;
		recordProcessed("completed");
`.trim();
const REPLY_OUTCOME_SILENT_REPLACEMENT = `
const counts = dispatcher.getQueuedCounts();
		counts.final += routedFinalCount;
		if (!queuedFinal) emitReplyOutcome("silent", "no_final_reply");
		recordProcessed("completed");
`.trim();
const REPLY_OUTCOME_ERROR_SEARCH = `
recordProcessed("error", { error: String(err) });
		markIdle("message_error");
`.trim();
const REPLY_OUTCOME_ERROR_REPLACEMENT = `
emitReplyOutcome("failed", "dispatch_threw", err instanceof Error ? err.message : String(err));
		recordProcessed("error", { error: String(err) });
		markIdle("message_error");
`.trim();
const FEISHU_ERROR_REPLY_SUPPRESS_GUARD_SEARCH = `
const genericErrorText = "The AI service returned an error. Please try again.";
	const suppressErrorTextReply = params.messageChannel === "feishu" && lastAssistantErrored;
	if (errorText && !suppressErrorTextReply) replyItems.push({
`.trim();
const FEISHU_ERROR_REPLY_SUPPRESS_GUARD_REPLACEMENT = `
const genericErrorText = "The AI service returned an error. Please try again.";
	const suppressErrorTextReply = (params.messageChannel === "feishu" || params.messageProvider === "feishu") && lastAssistantErrored;
	if (errorText && !suppressErrorTextReply) replyItems.push({
`.trim();
const CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_SEARCH = `
toolResultFormat: resolvedToolResultFormat,
					messageChannel: params.messageChannel,
					suppressToolErrorWarnings: params.suppressToolErrorWarnings,
					inlineToolResultsAllowed: false,
`.trim();
const CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_REPLACEMENT = `
toolResultFormat: resolvedToolResultFormat,
					messageChannel: params.messageChannel,
					messageProvider: params.messageProvider,
					suppressToolErrorWarnings: params.suppressToolErrorWarnings,
					inlineToolResultsAllowed: false,
`.trim();
const FEISHU_PRE_REPLY_FINAL_SEARCH = [
  "defaultRuntime.error(`Embedded agent failed before reply: ${message}`);",
  '\t\tconst trimmedMessage = (isTransientHttp ? sanitizeUserFacingText(message, { errorContext: true }) : message).replace(/\\.\\s*$/, "");',
  "\t\treturn {",
  '\t\t\tkind: "final",',
  '\t\t\tpayload: { text: isContextOverflow ? "⚠️ Context overflow — prompt too large for this model. Try a shorter message or a larger-context model." : isRoleOrderingError ? "⚠️ Message ordering conflict - please try again. If this persists, use /new to start a fresh session." : `⚠️ Agent failed before reply: ${trimmedMessage}.\\nLogs: openclaw logs --follow` }',
  "\t\t};",
].join("\n");
const FEISHU_PRE_REPLY_FINAL_REPLACEMENT = [
  "defaultRuntime.error(`Embedded agent failed before reply: ${message}`);",
  '\t\tconst trimmedMessage = (isTransientHttp ? sanitizeUserFacingText(message, { errorContext: true }) : message).replace(/\\.\\s*$/, "");',
  '\t\tif (resolveMessageChannel(params.sessionCtx.Surface, params.sessionCtx.Provider) === "feishu") return {',
  '\t\t\tkind: "success",',
  "\t\t\trunId,",
  "\t\t\trunResult: { payloads: [] },",
  "\t\t\tfallbackProvider,",
  "\t\t\tfallbackModel,",
  "\t\t\tfallbackAttempts,",
  "\t\t\tdidLogHeartbeatStrip,",
  "\t\t\tautoCompactionCompleted,",
  "\t\t\tdirectlySentBlockKeys: directlySentBlockKeys.size > 0 ? directlySentBlockKeys : void 0",
  "\t\t};",
  "\t\treturn {",
  '\t\t\tkind: "final",',
  '\t\t\tpayload: { text: isContextOverflow ? "⚠️ Context overflow — prompt too large for this model. Try a shorter message or a larger-context model." : isRoleOrderingError ? "⚠️ Message ordering conflict - please try again. If this persists, use /new to start a fresh session." : `⚠️ Agent failed before reply: ${trimmedMessage}.\\nLogs: openclaw logs --follow` }',
  "\t\t};",
].join("\n");
const PLUGIN_SDK_BUNDLE_PATTERNS = [/^reply-.*\.js$/u, /^dispatch-.*\.js$/u];
const CORE_DIST_REPLY_BUNDLE_PATTERNS = [/^reply-.*\.js$/u];
const FEISHU_PRE_LLM_SINGLE_AGENT_SEARCH = `
      // --- Single-agent dispatch (existing behavior) ---
      const ctxPayload = buildCtxPayloadForAgent(
        route.sessionKey,
        route.accountId,
        ctx.mentionedBot,
      );
`.trim();
const FEISHU_SYNTHETIC_PRE_LLM_LINES = [
  "      const syntheticFailureTriggerPrefix = process.env.NEXU_FEISHU_TEST_TRIGGER_PREFIX?.trim();",
  "      if (syntheticFailureTriggerPrefix && ctx.content.includes(syntheticFailureTriggerPrefix)) {",
  "        const syntheticInput = ctx.content.slice(ctx.content.indexOf(syntheticFailureTriggerPrefix) + syntheticFailureTriggerPrefix.length).trim();",
  "        runtime.log?.(`NEXU_EVENT channel.reply_outcome ${JSON.stringify({",
  '          channel: "feishu",',
  '          status: "failed",',
  '          reasonCode: "synthetic_pre_llm_failure",',
  "          accountId: account.accountId,",
  "          chatId: ctx.chatId,",
  "          replyToMessageId: replyTargetMessageId,",
  "          threadId: ctx.rootId,",
  "          sessionKey: route.sessionKey,",
  "          syntheticInput,",
  '          error: "synthetic pre-llm failure",',
  "          ts: new Date().toISOString(),",
  "        })}`);",
  "        log(",
  "          `feishu[${account.accountId}]: synthetic pre-llm failure triggered (session=${route.sessionKey})`,",
  "        );",
  "        return;",
  "      }",
];
const FEISHU_SYNTHETIC_PRE_LLM_BLOCK =
  FEISHU_SYNTHETIC_PRE_LLM_LINES.join("\n");
const FEISHU_PRE_LLM_SINGLE_AGENT_REPLACEMENT = [
  "      // --- Single-agent dispatch (existing behavior) ---",
  "      const ctxPayload = buildCtxPayloadForAgent(",
  "        route.sessionKey,",
  "        route.accountId,",
  "        ctx.mentionedBot,",
  "      );",
  ...FEISHU_SYNTHETIC_PRE_LLM_LINES,
].join("\n");
const LEGACY_FEISHU_TRIGGER_CALLSITE = `
        accountId: account.accountId,
        syntheticFailureTriggerText: ctx.content,
        messageCreateTimeMs,
`.trim();
const LEGACY_FEISHU_TRIGGER_CALLSITE_REPLACEMENT = `
        accountId: account.accountId,
        messageCreateTimeMs,
`.trim();
const LEGACY_FEISHU_PRE_LLM_BLOCK = [
  '                if (ctx.content.includes("__fail_reply__")) {',
  "        runtime.log?.(`NEXU_EVENT channel.reply_outcome ${JSON.stringify({",
  '          channel: "feishu",',
  '          status: "failed",',
  '          reasonCode: "synthetic_pre_llm_failure",',
  "          accountId: account.accountId,",
  "          chatId: ctx.chatId,",
  "          replyToMessageId: replyTargetMessageId,",
  "          threadId: ctx.rootId,",
  "          sessionKey: route.sessionKey,",
  '          error: "synthetic pre-llm failure",',
  "          ts: new Date().toISOString(),",
  "        })}`);",
  "        log(",
  "          `feishu[${account.accountId}]: synthetic pre-llm failure triggered (session=${route.sessionKey})`,",
  "        );",
  "        return;",
  "      }",
  "",
].join("\n");
const LEGACY_FEISHU_SINGLE_AGENT_TRIGGER_BLOCK = [
  '      if (ctx.content.includes("__fail_reply__")) {',
  "        runtime.log?.(`NEXU_EVENT channel.reply_outcome ${JSON.stringify({",
  '          channel: "feishu",',
  '          status: "failed",',
  '          reasonCode: "synthetic_pre_llm_failure",',
  "          accountId: account.accountId,",
  "          chatId: ctx.chatId,",
  "          replyToMessageId: replyTargetMessageId,",
  "          threadId: ctx.rootId,",
  "          sessionKey: route.sessionKey,",
  '          error: "synthetic pre-llm failure",',
  "          ts: new Date().toISOString(),",
  "        })}`);",
  "        log(",
  "          `feishu[${account.accountId}]: synthetic pre-llm failure triggered (session=${route.sessionKey})`,",
  "        );",
  "        return;",
  "      }",
].join("\n");

type StageLog = (message: string) => void;

type StageManifest = {
  fingerprint: string;
  patchedFileCount: number;
  createdAt: string;
};

export type PrepareOpenclawRuntimeStageOptions = {
  sourceOpenclawRoot: string;
  patchRoot: string;
  targetStageRoot: string;
  log?: StageLog;
};

export type PrepareOpenclawRuntimeStageResult = {
  stagedOpenclawRoot: string;
  patchedFileCount: number;
  reused: boolean;
  fingerprint: string;
};

function emitLog(log: StageLog | undefined, message: string): void {
  log?.(message);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await readFile(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    await readdir(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of [...entries].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = resolve(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
}

async function readOverlayFiles(
  patchRoot: string,
  log?: StageLog,
): Promise<Map<string, string>> {
  const patchedFiles = new Map<string, string>();
  const openclawPackagePatchRoot = resolve(
    patchRoot,
    OPENCLAW_PACKAGE_PATCH_DIRNAME,
  );

  if (!(await directoryExists(openclawPackagePatchRoot))) {
    return patchedFiles;
  }

  const patchFiles = await collectFiles(openclawPackagePatchRoot);

  for (const patchFilePath of patchFiles) {
    patchedFiles.set(
      relative(openclawPackagePatchRoot, patchFilePath),
      await readFile(patchFilePath, "utf8"),
    );
  }

  if (patchFiles.length > 0) {
    emitLog(
      log,
      `[openclaw-runtime-stage] prepared ${patchFiles.length} overlay patch file(s) from ${openclawPackagePatchRoot}`,
    );
  }

  return patchedFiles;
}

function applyExactReplacement(
  source: string,
  search: string,
  replacement: string,
  label: string,
): string {
  if (!source.includes(search)) {
    throw new Error(`Unable to locate patch anchor for ${label}.`);
  }

  return source.replace(search, replacement);
}

function countOccurrences(source: string, search: string): number {
  if (search.length === 0) {
    return 0;
  }

  let count = 0;
  let index = 0;

  while (true) {
    const nextIndex = source.indexOf(search, index);
    if (nextIndex === -1) {
      return count;
    }
    count += 1;
    index = nextIndex + search.length;
  }
}

async function patchReplyOutcomeBridge(
  openclawPackageRoot: string,
  log?: StageLog,
): Promise<Map<string, string>> {
  const patchedFiles = new Map<string, string>();
  const feishuBotPath = resolve(
    openclawPackageRoot,
    "extensions",
    "feishu",
    "src",
    "bot.ts",
  );
  let feishuBotSource = await readFile(feishuBotPath, "utf8");

  if (feishuBotSource.includes(LEGACY_FEISHU_PRE_LLM_BLOCK)) {
    feishuBotSource = feishuBotSource.replaceAll(
      LEGACY_FEISHU_PRE_LLM_BLOCK,
      "",
    );
  }

  if (feishuBotSource.includes(LEGACY_FEISHU_SINGLE_AGENT_TRIGGER_BLOCK)) {
    feishuBotSource = feishuBotSource.replaceAll(
      LEGACY_FEISHU_SINGLE_AGENT_TRIGGER_BLOCK,
      FEISHU_PRE_LLM_SINGLE_AGENT_REPLACEMENT,
    );
  }

  if (feishuBotSource.includes(LEGACY_FEISHU_TRIGGER_CALLSITE)) {
    feishuBotSource = feishuBotSource.replaceAll(
      LEGACY_FEISHU_TRIGGER_CALLSITE,
      LEGACY_FEISHU_TRIGGER_CALLSITE_REPLACEMENT,
    );
  }

  if (feishuBotSource.includes(FEISHU_SYNTHETIC_PRE_LLM_BLOCK)) {
    feishuBotSource = feishuBotSource.replaceAll(
      FEISHU_SYNTHETIC_PRE_LLM_BLOCK,
      "",
    );
  }

  if (feishuBotSource.includes(FEISHU_PRE_LLM_SINGLE_AGENT_SEARCH)) {
    feishuBotSource = feishuBotSource.replace(
      FEISHU_PRE_LLM_SINGLE_AGENT_SEARCH,
      FEISHU_PRE_LLM_SINGLE_AGENT_REPLACEMENT,
    );
    emitLog(
      log,
      "[openclaw-runtime-stage] patched feishu single-agent pre-llm trigger",
    );
  }

  if (countOccurrences(feishuBotSource, FEISHU_SYNTHETIC_PRE_LLM_BLOCK) !== 1) {
    throw new Error(
      "Feishu bot patch did not converge to a single synthetic pre-llm block.",
    );
  }

  if (feishuBotSource.includes("return;\n      }\n        route.sessionKey,")) {
    throw new Error(
      "Feishu bot patch left a dangling buildCtxPayloadForAgent argument tail.",
    );
  }

  patchedFiles.set(
    relative(openclawPackageRoot, feishuBotPath),
    feishuBotSource,
  );

  const patchBundleGroup = async (
    bundleDir: string,
    patterns: readonly RegExp[],
    label: string,
  ) => {
    const entries = await readdir(bundleDir);
    const bundleNames = entries
      .filter((entry) => patterns.some((pattern) => pattern.test(entry)))
      .sort((left, right) => left.localeCompare(right));

    if (bundleNames.length === 0) {
      throw new Error(`Unable to locate OpenClaw ${label} bundles.`);
    }

    for (const bundleName of bundleNames) {
      const bundlePath = resolve(bundleDir, bundleName);
      let source = await readFile(bundlePath, "utf8");

      if (!source.includes("NEXU_EVENT channel.reply_outcome")) {
        source = applyExactReplacement(
          source,
          REPLY_OUTCOME_HELPER_SEARCH,
          REPLY_OUTCOME_HELPER_REPLACEMENT,
          `${bundleName}: reply outcome helper`,
        );
        source = applyExactReplacement(
          source,
          REPLY_OUTCOME_SILENT_SEARCH,
          REPLY_OUTCOME_SILENT_REPLACEMENT,
          `${bundleName}: silent outcome emit`,
        );
        source = applyExactReplacement(
          source,
          REPLY_OUTCOME_ERROR_SEARCH,
          REPLY_OUTCOME_ERROR_REPLACEMENT,
          `${bundleName}: error outcome emit`,
        );
        emitLog(
          log,
          `[openclaw-runtime-stage] patched reply outcome bridge in ${bundleName}`,
        );
      }

      if (source.includes(FEISHU_ERROR_REPLY_SUPPRESS_GUARD_SEARCH)) {
        source = applyExactReplacement(
          source,
          FEISHU_ERROR_REPLY_SUPPRESS_GUARD_SEARCH,
          FEISHU_ERROR_REPLY_SUPPRESS_GUARD_REPLACEMENT,
          `${bundleName}: feishu error reply suppress guard`,
        );
        emitLog(
          log,
          `[openclaw-runtime-stage] patched feishu error final suppression in ${bundleName}`,
        );
      }

      if (source.includes(CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_SEARCH)) {
        source = applyExactReplacement(
          source,
          CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_SEARCH,
          CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_REPLACEMENT,
          `${bundleName}: core embedded payload message provider`,
        );
        emitLog(
          log,
          `[openclaw-runtime-stage] patched embedded payload message provider in ${bundleName}`,
        );
      }

      if (
        !source.includes("runResult: { payloads: [] }") &&
        source.includes(FEISHU_PRE_REPLY_FINAL_SEARCH)
      ) {
        source = applyExactReplacement(
          source,
          FEISHU_PRE_REPLY_FINAL_SEARCH,
          FEISHU_PRE_REPLY_FINAL_REPLACEMENT,
          `${bundleName}: feishu pre-reply final suppression`,
        );
        emitLog(
          log,
          `[openclaw-runtime-stage] patched feishu pre-reply final suppression in ${bundleName}`,
        );
      }

      patchedFiles.set(relative(openclawPackageRoot, bundlePath), source);
    }
  };

  await patchBundleGroup(
    resolve(openclawPackageRoot, "dist", "plugin-sdk"),
    PLUGIN_SDK_BUNDLE_PATTERNS,
    "plugin-sdk reply/dispatch",
  );
  await patchBundleGroup(
    resolve(openclawPackageRoot, "dist"),
    CORE_DIST_REPLY_BUNDLE_PATTERNS,
    "core dist reply",
  );

  return patchedFiles;
}

async function collectFingerprintFiles(
  sourceOpenclawRoot: string,
  patchRoot: string,
): Promise<Array<{ label: string; path: string }>> {
  const files: Array<{ label: string; path: string }> = [];
  const sourceCandidates = [
    resolve(sourceOpenclawRoot, "package.json"),
    resolve(sourceOpenclawRoot, "extensions", "feishu", "src", "bot.ts"),
  ];

  for (const sourceFilePath of sourceCandidates) {
    if (await pathExists(sourceFilePath)) {
      files.push({
        label: `source:${relative(sourceOpenclawRoot, sourceFilePath)}`,
        path: sourceFilePath,
      });
    }
  }

  const bundleTargets = [
    {
      dir: resolve(sourceOpenclawRoot, "dist", "plugin-sdk"),
      patterns: PLUGIN_SDK_BUNDLE_PATTERNS,
    },
    {
      dir: resolve(sourceOpenclawRoot, "dist"),
      patterns: CORE_DIST_REPLY_BUNDLE_PATTERNS,
    },
  ];

  for (const target of bundleTargets) {
    if (!(await directoryExists(target.dir))) {
      continue;
    }

    const entries = await readdir(target.dir);
    for (const entry of entries
      .filter((name) => target.patterns.some((pattern) => pattern.test(name)))
      .sort((left, right) => left.localeCompare(right))) {
      const bundlePath = resolve(target.dir, entry);
      files.push({
        label: `source:${relative(sourceOpenclawRoot, bundlePath)}`,
        path: bundlePath,
      });
    }
  }

  const openclawPackagePatchRoot = resolve(
    patchRoot,
    OPENCLAW_PACKAGE_PATCH_DIRNAME,
  );
  if (await directoryExists(openclawPackagePatchRoot)) {
    for (const patchFilePath of await collectFiles(openclawPackagePatchRoot)) {
      files.push({
        label: `patch:${relative(openclawPackagePatchRoot, patchFilePath)}`,
        path: patchFilePath,
      });
    }
  }

  return files;
}

async function computeStageFingerprint(
  sourceOpenclawRoot: string,
  patchRoot: string,
): Promise<string> {
  const hash = createHash("sha256");
  hash.update(`${STAGE_PATCH_VERSION}\n`);

  for (const file of await collectFingerprintFiles(
    sourceOpenclawRoot,
    patchRoot,
  )) {
    hash.update(`${file.label}\n`);
    hash.update(await readFile(file.path));
    hash.update("\n");
  }

  return hash.digest("hex");
}

async function readStageManifest(
  stageRoot: string,
): Promise<StageManifest | null> {
  const manifestPath = resolve(stageRoot, STAGE_MANIFEST_FILENAME);

  if (!(await pathExists(manifestPath))) {
    return null;
  }

  return JSON.parse(await readFile(manifestPath, "utf8")) as StageManifest;
}

export async function prepareOpenclawRuntimeStage(
  options: PrepareOpenclawRuntimeStageOptions,
): Promise<PrepareOpenclawRuntimeStageResult> {
  const fingerprint = await computeStageFingerprint(
    options.sourceOpenclawRoot,
    options.patchRoot,
  );
  const existingManifest = await readStageManifest(options.targetStageRoot);
  const existingOpenclawRoot = resolve(options.targetStageRoot, "openclaw");

  if (
    existingManifest?.fingerprint === fingerprint &&
    (await directoryExists(existingOpenclawRoot))
  ) {
    emitLog(
      options.log,
      `[openclaw-runtime-stage] reusing staged OpenClaw package at ${options.targetStageRoot}`,
    );
    return {
      stagedOpenclawRoot: existingOpenclawRoot,
      patchedFileCount: existingManifest.patchedFileCount,
      reused: true,
      fingerprint,
    };
  }

  await mkdir(dirname(options.targetStageRoot), { recursive: true });
  const stageRoot = await mkdtemp(
    resolve(
      dirname(options.targetStageRoot),
      `.${basename(options.targetStageRoot)}-stage-`,
    ),
  );
  const stagedOpenclawRoot = resolve(stageRoot, "openclaw");

  await cp(options.sourceOpenclawRoot, stagedOpenclawRoot, {
    recursive: true,
    dereference: true,
  });

  const overlayFiles = await readOverlayFiles(options.patchRoot, options.log);
  const bridgePatchedFiles = await patchReplyOutcomeBridge(
    stagedOpenclawRoot,
    options.log,
  );
  const patchedFiles = new Map([...overlayFiles, ...bridgePatchedFiles]);

  for (const [patchRelativePath, patchedSource] of patchedFiles) {
    await writeFile(
      resolve(stagedOpenclawRoot, patchRelativePath),
      patchedSource,
      "utf8",
    );
  }

  const manifest: StageManifest = {
    fingerprint,
    patchedFileCount: patchedFiles.size,
    createdAt: new Date().toISOString(),
  };
  await writeFile(
    resolve(stageRoot, STAGE_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  await rm(options.targetStageRoot, { recursive: true, force: true });
  await rename(stageRoot, options.targetStageRoot);

  emitLog(
    options.log,
    `[openclaw-runtime-stage] staged OpenClaw package with ${patchedFiles.size} patched file(s) at ${options.targetStageRoot}`,
  );

  return {
    stagedOpenclawRoot: resolve(options.targetStageRoot, "openclaw"),
    patchedFileCount: patchedFiles.size,
    reused: false,
    fingerprint,
  };
}
