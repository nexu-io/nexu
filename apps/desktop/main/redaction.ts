const SENSITIVE_KEY_RE = /token|password|secret|key|dsn/i;

const SENSITIVE_URL_PARAM_RE = /([?&#])(token|password|secret)(=[^&#\s]*)/gi;

export function scrubUrlTokens(str: string): string {
  return str.replace(SENSITIVE_URL_PARAM_RE, "$1$2=[REDACTED]");
}

export function redactJsonValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    if (key && SENSITIVE_KEY_RE.test(key)) {
      return "[REDACTED]";
    }
    return scrubUrlTokens(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJsonValue(item));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [nestedKey, nestedValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[nestedKey] = redactJsonValue(nestedValue, nestedKey);
    }
    return result;
  }

  return value;
}
