import type { OpenClawConfig } from "@nexu/shared";

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortJsonValue(nestedValue)]),
    );
  }

  return value;
}

export function normalizeOpenClawConfig(
  config: OpenClawConfig,
): OpenClawConfig {
  return sortJsonValue(config) as OpenClawConfig;
}

export function serializeOpenClawConfig(config: OpenClawConfig): string {
  return `${JSON.stringify(normalizeOpenClawConfig(config), null, 2)}\n`;
}
