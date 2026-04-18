import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listWeixinAccountIds, saveWeixinAccount } from "./accounts.js";

function makeConfig(accountIds: string[]) {
  return {
    channels: {
      "openclaw-weixin": {
        accounts: Object.fromEntries(accountIds.map((id) => [id, { enabled: true }])),
      },
    },
  };
}

describe("listWeixinAccountIds", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    delete process.env.OPENCLAW_STATE_DIR;
    for (const dir of tempRoots.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to config accounts when the index file is missing", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-accounts-"));
    tempRoots.push(stateDir);
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const accountIds = listWeixinAccountIds(
      makeConfig(["58550d4f9aa4-im-bot", "58550d4f9aa4-im-bot"]),
    );

    expect(accountIds).toEqual(["58550d4f9aa4-im-bot"]);
  });

  it("includes persisted account files even when the index file is missing", () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "weixin-accounts-"));
    tempRoots.push(stateDir);
    process.env.OPENCLAW_STATE_DIR = stateDir;

    saveWeixinAccount("legacy@im.bot", { token: "secret" });

    const accountIds = listWeixinAccountIds(makeConfig([]));

    expect(accountIds).toEqual(["legacy-im-bot"]);
  });
});
