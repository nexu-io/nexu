import i18n from "i18next";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import {
  type Locale,
  detectPreferredLocale,
  persistLocale,
} from "../lib/locale";

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const LocaleContext = createContext<LocaleCtx>({
  locale: "en",
  setLocale: () => {},
  t: (k) => k,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectPreferredLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    i18n.changeLanguage(l);
    persistLocale(l);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: locale dependency forces re-render on language change
  const t = useCallback(
    (key: string) => {
      return i18n.t(key);
    },
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  return useContext(LocaleContext);
}
