import { spawn } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  electronRoot,
  getSidecarRoot,
  linkOrCopyDirectory,
  pathExists,
  removePathIfExists,
  repoRoot,
  resetDir,
  shouldCopyRuntimeDependencies,
} from "./lib/sidecar-paths.mjs";

const openclawRuntimeRoot = resolve(repoRoot, "openclaw-runtime");
const openclawRuntimeNodeModules = resolve(openclawRuntimeRoot, "node_modules");
const openclawRoot = resolve(openclawRuntimeNodeModules, "openclaw");
const openclawRuntimePatchesRoot = resolve(
  repoRoot,
  "openclaw-runtime-patches",
);
const openclawPackagePatchRoot = resolve(
  openclawRuntimePatchesRoot,
  "openclaw",
);
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
  "        // TODO: Trace the actual runtime execution path for synthetic failures; the staged src patch is applied, but the live fallback path still appears to bypass this exact branch in some runs.",
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
const sidecarRoot = getSidecarRoot("openclaw");
const sidecarBinDir = resolve(sidecarRoot, "bin");
const sidecarNodeModules = resolve(sidecarRoot, "node_modules");
const packagedOpenclawEntry = resolve(
  sidecarNodeModules,
  "openclaw/openclaw.mjs",
);
const inheritEntitlementsPath = resolve(
  electronRoot,
  "build/entitlements.mac.inherit.plist",
);

function formatDurationMs(durationMs) {
  return `${(durationMs / 1000).toFixed(2)}s`;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? electronRoot,
      env: options.env ?? process.env,
      stdio: "inherit",
    });

    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun();
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}.`,
        ),
      );
    });
  });
}

async function runAndCapture(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      cwd: options.cwd ?? electronRoot,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) {
        resolveRun({ stdout, stderr });
        return;
      }

      rejectRun(
        new Error(
          `${command} ${args.join(" ")} exited with code ${code ?? "null"}. ${stderr}`,
        ),
      );
    });
  });
}

async function collectFiles(rootPath) {
  const files = [];
  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
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

const nativeBinaryNamePattern = /\.(?:node|dylib|so|dll)$/u;
const nativeBinaryBasenames = new Set(["spawn-helper"]);

function isNativeBinaryCandidate(filePath) {
  const baseName = basename(filePath);
  return (
    nativeBinaryNamePattern.test(baseName) ||
    nativeBinaryBasenames.has(baseName)
  );
}

async function resolveCodesignIdentity() {
  const { stdout } = await runAndCapture("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ]);
  const identityLine = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.includes("Developer ID Application:"));

  if (!identityLine) {
    throw new Error(
      "Unable to locate a Developer ID Application signing identity.",
    );
  }

  const match = identityLine.match(/"([^"]+)"/u);
  if (!match) {
    throw new Error(`Unable to parse signing identity from: ${identityLine}`);
  }

  return match[1];
}

function getSigningCertificatePath() {
  const link = process.env.CSC_LINK;

  if (!link) {
    return null;
  }

  return link.startsWith("file://") ? fileURLToPath(link) : link;
}

async function ensureCodesignIdentity() {
  try {
    return await resolveCodesignIdentity();
  } catch {
    const certificatePath = getSigningCertificatePath();
    const certificatePassword = process.env.CSC_KEY_PASSWORD;

    if (!certificatePath || !certificatePassword) {
      throw new Error(
        "Unable to locate a Developer ID Application signing identity.",
      );
    }

    const keychainPath = resolve(tmpdir(), "nexu-openclaw-signing.keychain-db");
    const keychainPassword = "nexu-openclaw-signing";

    await run("security", [
      "create-keychain",
      "-p",
      keychainPassword,
      keychainPath,
    ]).catch(() => null);
    await run("security", [
      "set-keychain-settings",
      "-lut",
      "21600",
      keychainPath,
    ]);
    await run("security", [
      "unlock-keychain",
      "-p",
      keychainPassword,
      keychainPath,
    ]);
    await run("security", [
      "import",
      certificatePath,
      "-k",
      keychainPath,
      "-P",
      certificatePassword,
      "-T",
      "/usr/bin/codesign",
      "-T",
      "/usr/bin/security",
    ]);
    await run("security", [
      "set-key-partition-list",
      "-S",
      "apple-tool:,apple:,codesign:",
      "-s",
      "-k",
      keychainPassword,
      keychainPath,
    ]);

    const { stdout: keychainsOutput } = await runAndCapture("security", [
      "list-keychains",
      "-d",
      "user",
    ]);
    const keychains = keychainsOutput
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/^"|"$/gu, ""))
      .filter(Boolean);
    if (!keychains.includes(keychainPath)) {
      await run("security", [
        "list-keychains",
        "-d",
        "user",
        "-s",
        keychainPath,
        ...keychains,
      ]);
    }

    return await resolveCodesignIdentity();
  }
}

async function signOpenclawNativeBinaries() {
  if (process.platform !== "darwin") {
    return;
  }

  const unsignedMode =
    process.env.NEXU_DESKTOP_MAC_UNSIGNED === "1" ||
    process.env.NEXU_DESKTOP_MAC_UNSIGNED === "true";

  if (unsignedMode || !shouldCopyRuntimeDependencies()) {
    return;
  }

  const startedAt = Date.now();
  const identity = await ensureCodesignIdentity();
  const files = await collectFiles(sidecarRoot);
  const candidateFiles = files.filter(isNativeBinaryCandidate);
  let machOCount = 0;

  console.log(
    `[openclaw-sidecar] scanning ${candidateFiles.length} native-binary candidates out of ${files.length} files`,
  );

  for (const filePath of candidateFiles) {
    const { stdout } = await runAndCapture("file", ["-b", filePath]);
    const description = stdout.trim();
    const isMachO = description.includes("Mach-O");

    if (!isMachO) {
      continue;
    }

    machOCount += 1;

    const isExecutable =
      description.includes("executable") || description.includes("bundle");
    const args = [
      "--force",
      "--sign",
      identity,
      "--timestamp",
      "--entitlements",
      inheritEntitlementsPath,
      ...(isExecutable ? ["--options", "runtime"] : []),
      filePath,
    ];
    await run("codesign", args);
  }

  console.log(
    `[openclaw-sidecar] signed ${machOCount} native binaries in ${formatDurationMs(
      Date.now() - startedAt,
    )}`,
  );
}

async function applyOpenclawRuntimePatches() {
  const patchedFiles = new Map();

  if (!(await pathExists(openclawPackagePatchRoot))) {
    return patchedFiles;
  }

  const patchFiles = await collectFiles(openclawPackagePatchRoot);

  for (const patchFilePath of patchFiles) {
    const patchFileRelativePath = relative(
      openclawPackagePatchRoot,
      patchFilePath,
    );
    patchedFiles.set(
      patchFileRelativePath,
      await readFile(patchFilePath, "utf8"),
    );
  }

  if (patchFiles.length > 0) {
    console.log(
      `[openclaw-sidecar] prepared ${patchFiles.length} runtime patch overlay(s) from ${openclawPackagePatchRoot}`,
    );
  }

  return patchedFiles;
}

function applyExactReplacement(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Unable to locate patch anchor for ${label}.`);
  }
  return source.replace(search, replacement);
}

function countOccurrences(source, search) {
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

async function patchReplyOutcomeBridge(openclawPackageRoot) {
  const patchedFiles = new Map();
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
    console.log(
      "[openclaw-sidecar] patched feishu single-agent pre-llm trigger",
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

  const patchBundleGroup = async (bundleDir, patterns, label) => {
    const entries = await readdir(bundleDir);
    const bundleNames = entries.filter((entry) =>
      patterns.some((pattern) => pattern.test(entry)),
    );

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

        console.log(
          `[openclaw-sidecar] patched reply outcome bridge in ${bundleName}`,
        );
      }

      if (source.includes(FEISHU_ERROR_REPLY_SUPPRESS_GUARD_SEARCH)) {
        source = applyExactReplacement(
          source,
          FEISHU_ERROR_REPLY_SUPPRESS_GUARD_SEARCH,
          FEISHU_ERROR_REPLY_SUPPRESS_GUARD_REPLACEMENT,
          `${bundleName}: feishu error reply suppress guard`,
        );

        console.log(
          `[openclaw-sidecar] patched feishu error final suppression in ${bundleName}`,
        );
      }

      if (source.includes(CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_SEARCH)) {
        source = applyExactReplacement(
          source,
          CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_SEARCH,
          CORE_EMBEDDED_PAYLOAD_MESSAGE_CHANNEL_REPLACEMENT,
          `${bundleName}: core embedded payload message provider`,
        );

        console.log(
          `[openclaw-sidecar] patched embedded payload message provider in ${bundleName}`,
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

        console.log(
          `[openclaw-sidecar] patched feishu pre-reply final suppression in ${bundleName}`,
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

async function stagePatchedOpenclawPackage() {
  await mkdir(dirname(sidecarRoot), { recursive: true });
  const stageRoot = await mkdtemp(
    resolve(dirname(sidecarRoot), ".openclaw-package-stage-"),
  );
  const stagedOpenclawRoot = resolve(stageRoot, "openclaw");

  await cp(openclawRoot, stagedOpenclawRoot, {
    recursive: true,
    dereference: true,
  });

  const overlayFiles = await applyOpenclawRuntimePatches();
  const bridgePatchedFiles = await patchReplyOutcomeBridge(stagedOpenclawRoot);
  const patchedFiles = new Map([...overlayFiles, ...bridgePatchedFiles]);

  for (const [patchRelativePath, patchedSource] of patchedFiles) {
    await writeFile(
      resolve(stagedOpenclawRoot, patchRelativePath),
      patchedSource,
      "utf8",
    );
  }

  console.log(
    `[openclaw-sidecar] staged transactional OpenClaw package with ${patchedFiles.size} patched file(s)`,
  );

  return { stageRoot, stagedOpenclawRoot };
}

async function prepareOpenclawSidecar() {
  if (!(await pathExists(openclawRoot))) {
    throw new Error(
      `OpenClaw runtime dependency not found at ${openclawRoot}. Run pnpm openclaw-runtime:install first.`,
    );
  }

  await resetDir(sidecarRoot);
  await mkdir(sidecarBinDir, { recursive: true });
  const { stageRoot, stagedOpenclawRoot } = await stagePatchedOpenclawPackage();
  try {
    await linkOrCopyDirectory(openclawRuntimeNodeModules, sidecarNodeModules, {
      excludeNames: ["openclaw"],
    });
    await rename(stagedOpenclawRoot, resolve(sidecarNodeModules, "openclaw"));
  } finally {
    await removePathIfExists(stageRoot);
  }

  await removePathIfExists(resolve(sidecarNodeModules, "electron"));
  await removePathIfExists(resolve(sidecarNodeModules, "electron-builder"));
  await chmod(packagedOpenclawEntry, 0o755).catch(() => null);
  await writeFile(
    resolve(sidecarRoot, "package.json"),
    '{\n  "name": "openclaw-sidecar",\n  "private": true\n}\n',
  );
  await writeFile(
    resolve(sidecarRoot, "metadata.json"),
    `${JSON.stringify(
      {
        strategy: "sidecar-node-modules",
        openclawEntry: packagedOpenclawEntry,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    resolve(sidecarBinDir, "openclaw.cmd"),
    `@echo off\r\nnode "${packagedOpenclawEntry}" %*\r\n`,
  );

  const wrapperPath = resolve(sidecarBinDir, "openclaw");
  await writeFile(
    wrapperPath,
    `#!/bin/sh
set -eu

case "$0" in
  */*) script_parent="\${0%/*}" ;;
  *) script_parent="." ;;
esac

script_dir="$(CDPATH= cd -- "$script_parent" && pwd)"
sidecar_root="$(CDPATH= cd -- "$script_dir/.." && pwd)"
entry="$sidecar_root/node_modules/openclaw/openclaw.mjs"

if command -v node >/dev/null 2>&1; then
  exec node "$entry" "$@"
fi

if [ -n "\${OPENCLAW_ELECTRON_EXECUTABLE:-}" ] && [ -x "$OPENCLAW_ELECTRON_EXECUTABLE" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "$OPENCLAW_ELECTRON_EXECUTABLE" "$entry" "$@"
fi

contents_dir="$(CDPATH= cd -- "$sidecar_root/../../.." && pwd)"
macos_dir="$contents_dir/MacOS"

if [ -d "$macos_dir" ]; then
  for candidate in "$macos_dir"/*; do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
      ELECTRON_RUN_AS_NODE=1 exec "$candidate" "$entry" "$@"
    fi
  done
fi

echo "openclaw launcher could not find node or a bundled Electron executable" >&2
exit 127
`,
  );
  await chmod(wrapperPath, 0o755);
  await signOpenclawNativeBinaries();

  if (shouldCopyRuntimeDependencies()) {
    const archivePath = resolve(
      dirname(sidecarRoot),
      "openclaw-sidecar.tar.gz",
    );
    await removePathIfExists(archivePath);
    await run("tar", ["-czf", archivePath, "-C", sidecarRoot, "."]);
    await resetDir(sidecarRoot);
    await writeFile(
      resolve(sidecarRoot, "archive.json"),
      `${JSON.stringify(
        {
          format: "tar.gz",
          path: "payload.tar.gz",
        },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      resolve(sidecarRoot, "package.json"),
      '{\n  "name": "openclaw-sidecar",\n  "private": true\n}\n',
    );
    await rename(archivePath, resolve(sidecarRoot, "payload.tar.gz"));
  }
}

await prepareOpenclawSidecar();
