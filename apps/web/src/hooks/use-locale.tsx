import i18n from "i18next";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  getApiInternalDesktopPreferences,
  patchApiInternalDesktopPreferences,
} from "../../lib/api/sdk.gen";

export type Locale = "en" | "zh";

interface LocaleCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const STORAGE_KEY = "nexu_locale";

function detectDefault(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
  } catch {
    /* ignore */
  }
  const lang = navigator.language || "";
  return lang.startsWith("zh") ? "zh" : "en";
}

const LocaleContext = createContext<LocaleCtx>({
  locale: "en",
  setLocale: () => {},
  t: (k) => k,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectDefault);
  const didBootstrapRef = useRef(false);
  // Tracks whether the user has manually changed the locale during this
  // session. The async bootstrap fetch must NOT override a user-made
  // selection that landed while the fetch was in flight (see #759).
  const userInteractedRef = useRef(false);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    if (didBootstrapRef.current) {
      return;
    }
    didBootstrapRef.current = true;
    void bootstrapLocale(setLocaleState, userInteractedRef);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    userInteractedRef.current = true;
    void i18n.changeLanguage(l);
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    void syncDesktopLocale(l);
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

async function syncDesktopLocale(locale: Locale): Promise<void> {
  await patchApiInternalDesktopPreferences({
    body: {
      locale: locale === "zh" ? "zh-CN" : "en",
    },
  }).catch(() => {
    // Best-effort sync only; local UI language should still work offline.
  });
}

async function bootstrapLocale(
  setLocaleState: (locale: Locale) => void,
  userInteractedRef: { current: boolean },
): Promise<void> {
  const localCandidate = detectDefault();

  const response = await getApiInternalDesktopPreferences().catch(() => null);
  const storedLocale = response?.data?.locale ?? null;

  // If the user already manually picked a locale while the GET above was in
  // flight, their selection is the source of truth — don't overwrite it.
  // Issue #759: on Windows zh-CN systems, the bootstrap was reverting a
  // user-selected English back to Chinese on the welcome screen.
  if (userInteractedRef.current) {
    return;
  }

  if (storedLocale === "en" || storedLocale === "zh-CN") {
    const nextLocale = storedLocale === "zh-CN" ? "zh" : "en";
    await i18n.changeLanguage(nextLocale);
    setLocaleState(nextLocale);
    try {
      localStorage.setItem(STORAGE_KEY, nextLocale);
    } catch {
      /* ignore */
    }
    return;
  }

  // Server has no stored locale yet. The useState initializer already set
  // the React state to `localCandidate`, so we deliberately do NOT call
  // setLocaleState here — calling it would race with any in-flight user
  // click and could revert their selection. We still persist the detected
  // default to localStorage and push it to the controller so the
  // credit-guard plugin and other locale-aware code see a consistent value.
  try {
    localStorage.setItem(STORAGE_KEY, localCandidate);
  } catch {
    /* ignore */
  }

  if (response) {
    await syncDesktopLocale(localCandidate);
  }
}
