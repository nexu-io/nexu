import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { detectPreferredLocale } from "../lib/locale";
import en from "./locales/en";
import zhCN from "./locales/zh-CN";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zhCN },
  },
  lng: detectPreferredLocale(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
