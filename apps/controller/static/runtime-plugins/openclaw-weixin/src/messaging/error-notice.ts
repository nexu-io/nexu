import { logger } from "../util/logger.js";
import { sendMessageWeixin } from "./send.js";

/**
 * Send a plain-text error notice back to the user.
 * Fire-and-forget: errors are logged but never thrown, so callers stay unaffected.
 * No-op when contextToken is absent (we have no conversation reference to reply into).
 */
export async function sendWeixinErrorNotice(params: {
  to: string;
  contextToken: string | undefined;
  message: string;
  baseUrl: string;
  token?: string;
  errLog: (m: string) => void;
}): Promise<void> {
  if (!params.contextToken) {
    logger.warn(
      `sendWeixinErrorNotice: no contextToken for to=${params.to}, cannot notify user`,
    );
    return;
  }
  try {
    await sendMessageWeixin({
      to: params.to,
      text: params.message,
      opts: {
        baseUrl: params.baseUrl,
        token: params.token,
        contextToken: params.contextToken,
      },
    });
    logger.debug(`sendWeixinErrorNotice: sent to=${params.to}`);
  } catch (err) {
    params.errLog(
      `[weixin] sendWeixinErrorNotice failed to=${params.to}: ${String(err)}`,
    );
  }
}
