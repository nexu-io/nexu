type ControllerReadyFetchResponse = {
  ok: boolean;
  json(): Promise<unknown>;
};

type ControllerReadyFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<ControllerReadyFetchResponse>;

export type ControllerReadyStatus = "polling" | "recovering";

export interface EnsureDesktopControllerReadyOptions {
  readyUrl: string;
  startController?: (() => Promise<void>) | null;
  fetchImpl?: ControllerReadyFetch;
  attemptTimeoutMs?: number;
  finalAttemptTimeoutMs?: number;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  recoveryAttempts?: number;
  onStatusChange?: (status: ControllerReadyStatus) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (
    typeof AbortSignal === "undefined" ||
    typeof AbortSignal.timeout !== "function"
  ) {
    return undefined;
  }

  return AbortSignal.timeout(timeoutMs);
}

function isReadyPayload(
  value: unknown,
): value is { ready?: boolean; coreReady?: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    ("ready" in value || "coreReady" in value)
  );
}

async function probeControllerReady(
  readyUrl: string,
  fetchImpl: ControllerReadyFetch,
  requestTimeoutMs: number,
): Promise<boolean> {
  try {
    const response = await fetchImpl(readyUrl, {
      signal: buildTimeoutSignal(requestTimeoutMs),
    });
    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return (
      isReadyPayload(payload) &&
      (payload.coreReady === true || payload.ready === true)
    );
  } catch {
    return false;
  }
}

async function pollUntilReady(opts: {
  readyUrl: string;
  fetchImpl: ControllerReadyFetch;
  attemptTimeoutMs?: number;
  pollIntervalMs: number;
  requestTimeoutMs: number;
}): Promise<boolean> {
  const deadline =
    typeof opts.attemptTimeoutMs === "number"
      ? Date.now() + opts.attemptTimeoutMs
      : Number.POSITIVE_INFINITY;

  while (true) {
    const ready = await probeControllerReady(
      opts.readyUrl,
      opts.fetchImpl,
      opts.requestTimeoutMs,
    );
    if (ready) {
      return true;
    }

    if (Date.now() >= deadline) {
      return false;
    }

    await sleep(opts.pollIntervalMs);
  }
}

export async function ensureDesktopControllerReady(
  options: EnsureDesktopControllerReadyOptions,
): Promise<boolean> {
  const fetchImpl = options.fetchImpl ?? (fetch as ControllerReadyFetch);
  const startController = options.startController ?? null;
  const recoveryAttempts =
    options.recoveryAttempts ?? (startController === null ? 0 : 1);
  const attemptTimeoutMs = options.attemptTimeoutMs ?? 15_000;
  const finalAttemptTimeoutMs =
    options.finalAttemptTimeoutMs ?? attemptTimeoutMs * 4;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 3_000;

  for (let attempt = 0; attempt <= recoveryAttempts; attempt += 1) {
    options.onStatusChange?.("polling");
    const isFinalAttempt = attempt === recoveryAttempts;
    // Final attempt gets a longer but still bounded timeout so that a crash-looping
    // controller eventually surfaces as `false` instead of leaking polling loops.
    const pollTimeoutMs =
      startController !== null && isFinalAttempt
        ? finalAttemptTimeoutMs
        : attemptTimeoutMs;

    const ready = await pollUntilReady({
      readyUrl: options.readyUrl,
      fetchImpl,
      attemptTimeoutMs: pollTimeoutMs,
      pollIntervalMs,
      requestTimeoutMs,
    });
    if (ready) {
      return true;
    }

    if (attempt >= recoveryAttempts || startController === null) {
      return false;
    }

    options.onStatusChange?.("recovering");

    try {
      await startController();
    } catch {
      return false;
    }
  }

  return false;
}
