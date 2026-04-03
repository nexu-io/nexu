const MANAGED_MODEL_PREFIX = "link/";

interface CloudModelLike {
  id: string;
  provider?: string;
}

export function resolveManagedCloudModel<T extends CloudModelLike>(
  modelId: string | null | undefined,
  cloudModels: readonly T[] | null | undefined,
): T | CloudModelLike | null {
  if (!modelId) {
    return null;
  }

  const matchedModel = (cloudModels ?? []).find(
    (model) => model.id === modelId,
  );
  if (matchedModel) {
    return matchedModel;
  }

  if (modelId.startsWith(MANAGED_MODEL_PREFIX)) {
    return {
      id: modelId,
      provider: modelId.split("/")[0],
    };
  }

  return null;
}

export function isManagedCloudModelId(
  modelId: string | null | undefined,
  cloudModels: readonly CloudModelLike[] | null | undefined,
): boolean {
  return resolveManagedCloudModel(modelId, cloudModels) !== null;
}
