import type {
  ChannelConnectErrorCode,
  ChannelConnectPhase,
} from "@nexu/shared";

type ChannelConnectErrorStatus = 422 | 502 | 503 | 504;

type ChannelConnectErrorOptions = {
  message: string;
  code: ChannelConnectErrorCode;
  status: ChannelConnectErrorStatus;
  retryable: boolean;
  phase: ChannelConnectPhase;
  upstreamHost?: string | null;
  upstreamStatus?: number | null;
};

export class ChannelConnectError extends Error {
  readonly code: ChannelConnectErrorCode;
  readonly status: ChannelConnectErrorStatus;
  readonly retryable: boolean;
  readonly phase: ChannelConnectPhase;
  readonly upstreamHost: string | null;
  readonly upstreamStatus: number | null;

  constructor(options: ChannelConnectErrorOptions) {
    super(options.message);
    this.name = "ChannelConnectError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.phase = options.phase;
    this.upstreamHost = options.upstreamHost ?? null;
    this.upstreamStatus = options.upstreamStatus ?? null;
  }
}

export function isChannelConnectError(
  error: unknown,
): error is ChannelConnectError {
  return error instanceof ChannelConnectError;
}
