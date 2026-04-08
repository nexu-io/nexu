import fs from "node:fs";
import path from "node:path";
import { rewardTasks } from "@nexu/shared";
import { describe, expect, it, vi } from "vitest";
import {
  downloadRandomRewardShareAsset,
  pickRandomRewardShareAsset,
  rewardShareAssets,
} from "#web/lib/reward-share-assets";

const rewardShareAssetsDir = path.resolve(
  import.meta.dirname,
  "../../apps/web/public/rewards/share-assets",
);

describe("rewardShareAssets", () => {
  it("keeps the manifest aligned with bundled static reward images", () => {
    const bundledFiles = fs
      .readdirSync(rewardShareAssetsDir)
      .filter((entry) => entry.endsWith(".png"))
      .sort();

    expect(rewardShareAssets.map((asset) => asset.fileName)).toEqual(
      bundledFiles,
    );
    expect(rewardShareAssets.every((asset) => asset.url.startsWith("/"))).toBe(
      true,
    );
  });

  it("covers every rewards task that requires downloading an image", () => {
    const imageTaskIds = rewardTasks
      .filter((task) => task.shareMode === "image")
      .map((task) => task.id);

    expect(imageTaskIds).toEqual(["mobile_share"]);
    expect(rewardShareAssets).toHaveLength(6);
  });
});

describe("pickRandomRewardShareAsset", () => {
  it("maps deterministic random values onto the bundled image pool", () => {
    expect(pickRandomRewardShareAsset(0).fileName).toBe("nexu-share-01.png");
    expect(pickRandomRewardShareAsset(0.2).fileName).toBe("nexu-share-02.png");
    expect(pickRandomRewardShareAsset(0.5).fileName).toBe("nexu-share-04.png");
    expect(pickRandomRewardShareAsset(0.999999).fileName).toBe(
      "nexu-share-06.png",
    );
  });
});

describe("downloadRandomRewardShareAsset", () => {
  it("downloads one of the bundled reward images with the expected file name", () => {
    const anchor = {
      href: "",
      download: "",
      rel: "",
      click: vi.fn(),
    };
    const documentLike = {
      createElement: vi.fn().mockReturnValue(anchor),
    };

    const selectedAsset = downloadRandomRewardShareAsset({
      document: documentLike,
      randomValue: 0.8,
    });

    expect(documentLike.createElement).toHaveBeenCalledWith("a");
    expect(selectedAsset.fileName).toBe("nexu-share-05.png");
    expect(anchor.href).toBe("/rewards/share-assets/nexu-share-05.png");
    expect(anchor.download).toBe("nexu-share-05.png");
    expect(anchor.rel).toBe("noopener");
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });
});
