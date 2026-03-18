export type Locale = "en" | "zh";

export const LOCALE_STORAGE_KEY = "nexu_locale";

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "en" || stored === "zh") {
      return stored;
    }
  } catch {
    /* ignore */
  }

  return null;
}

function readEnvironmentLanguages(): string[] {
  if (typeof navigator === "undefined") {
    return [];
  }

  const languages = Array.isArray(navigator.languages)
    ? navigator.languages
    : [];

  return [...languages, navigator.language].filter((value): value is string =>
    Boolean(value),
  );
}

function isZhLanguage(language: string): boolean {
  return language.toLowerCase().startsWith("zh");
}

export function detectPreferredLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) {
    return stored;
  }

  const environmentLanguages = readEnvironmentLanguages();
  if (environmentLanguages.some(isZhLanguage)) {
    return "zh";
  }

  try {
    const runtimeLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (runtimeLocale && isZhLanguage(runtimeLocale)) {
      return "zh";
    }
  } catch {
    /* ignore */
  }

  return "en";
}

export function shouldAutoRedirectToZh(pathname: string): boolean {
  return pathname === "/" && detectPreferredLocale() === "zh";
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}
