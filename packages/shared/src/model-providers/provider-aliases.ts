import { normalizeProviderId } from "./provider-registry.js";
import {
  type CustomProviderTemplateId,
  customProviderTemplateIds,
} from "./provider-types.js";

const customProviderTemplateIdSet = new Set<string>(customProviderTemplateIds);

export function isCustomProviderTemplate(
  providerId: string,
): providerId is CustomProviderTemplateId {
  return customProviderTemplateIdSet.has(providerId);
}

export function buildCustomProviderKey(
  templateId: CustomProviderTemplateId,
  instanceId: string,
): string {
  const normalizedInstanceId = instanceId.trim();
  if (normalizedInstanceId.length === 0) {
    throw new Error("Custom provider instanceId is required");
  }

  return `${templateId}/${normalizedInstanceId}`;
}

export function parseCustomProviderKey(key: string): {
  templateId: CustomProviderTemplateId;
  instanceId: string;
} | null {
  const slashIndex = key.indexOf("/");
  if (slashIndex <= 0 || slashIndex === key.length - 1) {
    return null;
  }

  const templateId = key.slice(0, slashIndex);
  const instanceId = key.slice(slashIndex + 1);
  const normalizedTemplateId = normalizeProviderId(templateId);
  if (
    !normalizedTemplateId ||
    !isCustomProviderTemplate(normalizedTemplateId)
  ) {
    return null;
  }

  return {
    templateId: normalizedTemplateId,
    instanceId,
  };
}
