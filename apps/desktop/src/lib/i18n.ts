/**
 * Lightweight i18n helper for desktop renderer components.
 *
 * Desktop renderer cannot reuse the web app's i18n framework (react-i18next)
 * because it runs in a separate Electron BrowserWindow with its own entry point.
 * Main process i18n uses Electron's `app.getLocale()` (see quit-handler.ts);
 * renderer uses `navigator.language` instead.
 */

/**
 * Returns the locale-appropriate string set based on `navigator.language`.
 * Falls back to English for any non-Chinese locale.
 * When `zh-TW` or `zh-HK` is detected and a `"zh-TW"` key exists, it is
 * preferred; otherwise falls back to `zh`.
 *
 * `en` and `zh` must share the same structural shape — string values may differ.
 */
export function resolveLocale<T>(strings: {
  en: T;
  zh: T;
  "zh-TW"?: T;
}): T {
  const lang = navigator.language;
  if (lang === "zh-TW" || lang === "zh-HK") {
    return strings["zh-TW"] ?? strings.zh;
  }
  return lang.startsWith("zh") ? strings.zh : strings.en;
}
