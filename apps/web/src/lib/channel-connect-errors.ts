type ChannelConnectErrorShape = {
  message?: string;
  code?: string;
  requestId?: string;
};

function isRecord(
  value: unknown,
): value is Record<string, string | number | boolean | null | undefined> {
  return typeof value === "object" && value !== null;
}

export function getChannelConnectError(
  error: unknown,
): ChannelConnectErrorShape {
  if (!isRecord(error)) {
    return {};
  }

  const message = typeof error.message === "string" ? error.message : undefined;
  const code = typeof error.code === "string" ? error.code : undefined;
  const requestId =
    typeof error.requestId === "string" ? error.requestId : undefined;

  return { message, code, requestId };
}

export function formatChannelConnectErrorMessage(
  error: unknown,
  fallback: string,
): string {
  const parsed = getChannelConnectError(error);
  if (!parsed.message) {
    return fallback;
  }

  if (!parsed.requestId) {
    return parsed.message;
  }

  return `${parsed.message} (request: ${parsed.requestId})`;
}

export function isAlreadyConnectedError(error: unknown): boolean {
  return getChannelConnectError(error).code === "already_connected";
}
