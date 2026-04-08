export type RewardShareAsset = {
  fileName: string;
  url: string;
};

export type RewardShareDownloadAnchor = {
  href: string;
  download: string;
  rel?: string;
  click: () => void;
};

export type RewardShareDownloadDocument = {
  createElement: (tagName: "a") => RewardShareDownloadAnchor;
};

export const rewardShareAssets: ReadonlyArray<RewardShareAsset> = [
  {
    fileName: "nexu-share-01.png",
    url: "/rewards/share-assets/nexu-share-01.png",
  },
  {
    fileName: "nexu-share-02.png",
    url: "/rewards/share-assets/nexu-share-02.png",
  },
  {
    fileName: "nexu-share-03.png",
    url: "/rewards/share-assets/nexu-share-03.png",
  },
  {
    fileName: "nexu-share-04.png",
    url: "/rewards/share-assets/nexu-share-04.png",
  },
  {
    fileName: "nexu-share-05.png",
    url: "/rewards/share-assets/nexu-share-05.png",
  },
  {
    fileName: "nexu-share-06.png",
    url: "/rewards/share-assets/nexu-share-06.png",
  },
] as const;

function clampRandomValue(randomValue: number): number {
  if (!Number.isFinite(randomValue)) {
    return 0;
  }

  if (randomValue <= 0) {
    return 0;
  }

  if (randomValue >= 1) {
    return 0.999999999999;
  }

  return randomValue;
}

export function pickRandomRewardShareAsset(
  randomValue = Math.random(),
): RewardShareAsset {
  const fallbackAsset = rewardShareAssets[0];
  if (!fallbackAsset) {
    throw new Error("No reward share assets configured");
  }

  const normalizedRandomValue = clampRandomValue(randomValue);
  const selectedIndex = Math.floor(
    normalizedRandomValue * rewardShareAssets.length,
  );

  return rewardShareAssets[selectedIndex] ?? fallbackAsset;
}

export function triggerRewardShareAssetDownload(
  asset: RewardShareAsset,
  documentLike: RewardShareDownloadDocument = document,
): void {
  const anchor = documentLike.createElement("a");
  anchor.href = asset.url;
  anchor.download = asset.fileName;
  anchor.rel = "noopener";
  anchor.click();
}

export function downloadRandomRewardShareAsset({
  document: documentLike = document,
  randomValue = Math.random(),
}: {
  document?: RewardShareDownloadDocument;
  randomValue?: number;
} = {}): RewardShareAsset {
  const asset = pickRandomRewardShareAsset(randomValue);
  triggerRewardShareAssetDownload(asset, documentLike);
  return asset;
}
