import { ANALYTICS_PREFERENCE_STORAGE_KEY } from "./tracking";

export function readAnalyticsPreferenceFromStorage(
  storage: Pick<Storage, "getItem"> | null | undefined,
): boolean | null {
  if (!storage) {
    return null;
  }

  try {
    const value = storage.getItem(ANALYTICS_PREFERENCE_STORAGE_KEY);
    if (value === "1") {
      return true;
    }
    if (value === "0") {
      return false;
    }
    return null;
  } catch {
    return null;
  }
}
