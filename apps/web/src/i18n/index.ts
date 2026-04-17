import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";

const STORAGE_KEY = "nexu_locale";

function detectLocale(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh-CN" || stored === "zh-TW") {
      return stored;
    }
    if (stored === "zh") {
      return "zh-CN";
    }
  } catch {
    /* ignore */
  }
  const lang = navigator.language || "";
  if (/^zh-(TW|HK|MO)$/i.test(lang) || /Hant/i.test(lang)) {
    return "zh-TW";
  }
  return lang.startsWith("zh") ? "zh-CN" : "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    "zh-CN": { translation: zhCN },
    "zh-TW": { translation: zhTW },
  },
  lng: detectLocale(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
