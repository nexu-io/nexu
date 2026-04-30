#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import {
  loadPageDeployConfig,
  queryPageDeployJob,
  recoverPendingPageDeployJobs,
  savePageDeployConfig,
  submitPageDeployJob,
  submitPageDeployTemplateJob,
  waitForPageDeployJob,
} from "./deploy_skill_core.js";

function nexuHome() {
  return process.env.NEXU_HOME?.trim() || path.join(os.homedir(), ".nexu");
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = value;
    index += 1;
  }

  return { command, options };
}

function printJson(payload, stream = process.stdout) {
  stream.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function usage() {
  printJson(
    {
      error:
        "Usage: deploy_skill.js <setup|check|submit|query|recover|wait-and-deliver> [options]",
    },
    process.stderr,
  );
  process.exit(1);
}

async function run() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const home = nexuHome();

  if (!command) {
    usage();
  }

  if (command === "setup") {
    if (typeof options["base-url"] !== "string") {
      throw new Error("setup requires --base-url");
    }
    const config = await savePageDeployConfig(home, {
      baseUrl: options["base-url"],
    });
    printJson({ status: "ok", config });
    return;
  }

  if (command === "check") {
    const config = await loadPageDeployConfig(home);
    if (typeof config.baseUrl !== "string" || config.baseUrl.length === 0) {
      throw new Error("deploy-skill baseUrl is not configured.");
    }
    printJson({ status: "ok", config });
    return;
  }

  if (command === "submit") {
    const commonInput = {
      nexuHome: home,
      botId: String(options["bot-id"] ?? ""),
      chatId: String(options["chat-id"] ?? ""),
      chatType: String(options["chat-type"] ?? ""),
      channel: String(options.channel ?? ""),
      to: typeof options.to === "string" ? options.to : undefined,
      threadId:
        typeof options["thread-id"] === "string"
          ? options["thread-id"]
          : undefined,
      accountId:
        typeof options["account-id"] === "string"
          ? options["account-id"]
          : undefined,
      sessionKey:
        typeof options["session-key"] === "string"
          ? options["session-key"]
          : undefined,
      userId:
        typeof options["user-id"] === "string" ? options["user-id"] : undefined,
    };
    const result =
      typeof options["template-id"] === "string"
        ? await submitPageDeployTemplateJob({
            ...commonInput,
            templateId: options["template-id"],
            contentFile: String(options["content-file"] ?? ""),
          })
        : await submitPageDeployJob({
            ...commonInput,
            zipPath: String(options.zip ?? ""),
          });

    printJson(result.spawnPayload);
    printJson(
      {
        jobId: result.job.jobId,
        status: result.job.status,
        message: "Deployment started. I will notify the user when it finishes.",
      },
      process.stderr,
    );
    return;
  }

  if (command === "query") {
    if (typeof options["job-id"] !== "string") {
      throw new Error("query requires --job-id");
    }
    const job = await queryPageDeployJob({
      nexuHome: home,
      jobId: options["job-id"],
    });
    printJson(job);
    return;
  }

  if (command === "recover") {
    const pendingJobs = await recoverPendingPageDeployJobs({ nexuHome: home });
    printJson({
      status: "ok",
      pendingCount: pendingJobs.length,
      jobs: pendingJobs,
    });
    return;
  }

  if (command === "wait-and-deliver") {
    if (typeof options["job-id"] !== "string") {
      throw new Error("wait-and-deliver requires --job-id");
    }
    const result = await waitForPageDeployJob({
      nexuHome: home,
      jobId: options["job-id"],
      pollIntervalMs: Number(options["poll-interval-ms"] ?? 10000),
      maxPolls: Number(options["max-polls"] ?? 30),
    });
    printJson({
      status: result.status,
      message: result.message,
      jobId: result.job.jobId,
      url: result.job.resultUrl,
    });
    return;
  }

  usage();
}

run().catch((error) => {
  printJson(
    {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    },
    process.stderr,
  );
  process.exit(1);
});
