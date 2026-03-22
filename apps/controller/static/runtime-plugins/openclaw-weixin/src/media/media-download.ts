import type { WeixinMessage } from "../api/types.js";
import { MessageItemType } from "../api/types.js";
import {
  downloadAndDecryptBuffer,
  downloadPlainCdnBuffer,
} from "../cdn/pic-decrypt.js";
import type { WeixinInboundMediaOpts } from "../messaging/inbound.js";
import { logger } from "../util/logger.js";
import { getMimeFromFilename } from "./mime.js";
import { silkToWav } from "./silk-transcode.js";

const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;

/** Persist a buffer via the framework's unified media store. */
type SaveMediaFn = (
  buffer: Buffer,
  contentType?: string,
  subdir?: string,
  maxBytes?: number,
  originalFilename?: string,
) => Promise<{ path: string }>;

/**
 * Download and decrypt media from a single MessageItem.
 * Returns the populated WeixinInboundMediaOpts fields; empty object on unsupported type or failure.
 */
export async function downloadMediaFromItem(
  item: WeixinMessage["item_list"] extends (infer T)[] | undefined ? T : never,
  deps: {
    cdnBaseUrl: string;
    saveMedia: SaveMediaFn;
    log: (msg: string) => void;
    errLog: (msg: string) => void;
    label: string;
  },
): Promise<WeixinInboundMediaOpts> {
  const { cdnBaseUrl, saveMedia, log, errLog, label } = deps;
  const result: WeixinInboundMediaOpts = {};

  if (item.type === MessageItemType.IMAGE) {
    const img = item.image_item;
    if (!img?.media?.encrypt_query_param) return result;
    const aesKeyBase64 = img.aeskey
      ? Buffer.from(img.aeskey, "hex").toString("base64")
      : img.media.aes_key;
    logger.debug(
      `${label} image: encrypt_query_param=${img.media.encrypt_query_param.slice(0, 40)}... hasAesKey=${Boolean(aesKeyBase64)} aeskeySource=${img.aeskey ? "image_item.aeskey" : "media.aes_key"}`,
    );
    try {
      const buf = aesKeyBase64
        ? await downloadAndDecryptBuffer(
            img.media.encrypt_query_param,
            aesKeyBase64,
            cdnBaseUrl,
            `${label} image`,
          )
        : await downloadPlainCdnBuffer(
            img.media.encrypt_query_param,
            cdnBaseUrl,
            `${label} image-plain`,
          );
      const saved = await saveMedia(
        buf,
        undefined,
        "inbound",
        WEIXIN_MEDIA_MAX_BYTES,
      );
      result.decryptedPicPath = saved.path;
      logger.debug(`${label} image saved: ${saved.path}`);
    } catch (err) {
      logger.error(`${label} image download/decrypt failed: ${String(err)}`);
      errLog(`weixin ${label} image download/decrypt failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.VOICE) {
    const voice = item.voice_item;
    if (!voice?.media?.encrypt_query_param || !voice.media.aes_key)
      return result;
    try {
      const silkBuf = await downloadAndDecryptBuffer(
        voice.media.encrypt_query_param,
        voice.media.aes_key,
        cdnBaseUrl,
        `${label} voice`,
      );
      logger.debug(
        `${label} voice: decrypted ${silkBuf.length} bytes, attempting silk transcode`,
      );
      const wavBuf = await silkToWav(silkBuf);
      if (wavBuf) {
        const saved = await saveMedia(
          wavBuf,
          "audio/wav",
          "inbound",
          WEIXIN_MEDIA_MAX_BYTES,
        );
        result.decryptedVoicePath = saved.path;
        result.voiceMediaType = "audio/wav";
        logger.debug(`${label} voice: saved WAV to ${saved.path}`);
      } else {
        const saved = await saveMedia(
          silkBuf,
          "audio/silk",
          "inbound",
          WEIXIN_MEDIA_MAX_BYTES,
        );
        result.decryptedVoicePath = saved.path;
        result.voiceMediaType = "audio/silk";
        logger.debug(
          `${label} voice: silk transcode unavailable, saved raw SILK to ${saved.path}`,
        );
      }
    } catch (err) {
      logger.error(`${label} voice download/transcode failed: ${String(err)}`);
      errLog(`weixin ${label} voice download/transcode failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.FILE) {
    const fileItem = item.file_item;
    if (!fileItem?.media?.encrypt_query_param || !fileItem.media.aes_key)
      return result;
    try {
      const buf = await downloadAndDecryptBuffer(
        fileItem.media.encrypt_query_param,
        fileItem.media.aes_key,
        cdnBaseUrl,
        `${label} file`,
      );
      const mime = getMimeFromFilename(fileItem.file_name ?? "file.bin");
      const saved = await saveMedia(
        buf,
        mime,
        "inbound",
        WEIXIN_MEDIA_MAX_BYTES,
        fileItem.file_name ?? undefined,
      );
      result.decryptedFilePath = saved.path;
      result.fileMediaType = mime;
      logger.debug(`${label} file: saved to ${saved.path} mime=${mime}`);
    } catch (err) {
      logger.error(`${label} file download failed: ${String(err)}`);
      errLog(`weixin ${label} file download failed: ${String(err)}`);
    }
  } else if (item.type === MessageItemType.VIDEO) {
    const videoItem = item.video_item;
    if (!videoItem?.media?.encrypt_query_param || !videoItem.media.aes_key)
      return result;
    try {
      const buf = await downloadAndDecryptBuffer(
        videoItem.media.encrypt_query_param,
        videoItem.media.aes_key,
        cdnBaseUrl,
        `${label} video`,
      );
      const saved = await saveMedia(
        buf,
        "video/mp4",
        "inbound",
        WEIXIN_MEDIA_MAX_BYTES,
      );
      result.decryptedVideoPath = saved.path;
      logger.debug(`${label} video: saved to ${saved.path}`);
    } catch (err) {
      logger.error(`${label} video download failed: ${String(err)}`);
      errLog(`weixin ${label} video download failed: ${String(err)}`);
    }
  }

  return result;
}
