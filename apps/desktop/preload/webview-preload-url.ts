import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function resolveWebviewPreloadUrl(preloadDir: string): string {
  return pathToFileURL(join(preloadDir, "webview-preload.js")).toString();
}
