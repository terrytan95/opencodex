import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { I18nContext, LOCALES, detectInitial, interpolate, setActiveLocale, type Locale, type TFn, type TKey, type Vars } from "./shared";
import { catalogFor, loadCatalog, loadedCatalog } from "./catalogs";
import { useI18n } from "./shared";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(detectInitial);
  const [selection, setSelection] = useState(() => {
    const locale = loadedCatalog(initial) ? initial : "en";
    setActiveLocale(locale);
    return { locale, committed: locale === initial };
  });
  const { locale, committed } = selection;
  const generation = useRef(0);

  const setLocale = useCallback((next: Locale) => {
    const requested = ++generation.current;
    const apply = () => {
      if (generation.current !== requested) return;
      setActiveLocale(next);
      setSelection({ locale: next, committed: true });
    };
    if (loadedCatalog(next)) apply();
    else void loadCatalog(next).then(apply).catch(() => {
      // Keep the working language and saved preference; selecting again retries the download.
    });
  }, []);

  useEffect(() => {
    setLocale(initial);
    return () => { generation.current += 1; };
  }, [initial, setLocale]);

  useEffect(() => {
    const meta = LOCALES.find(l => l.code === locale) ?? LOCALES[0];
    document.documentElement.lang = meta.htmlLang;
    if (committed) {
      try { localStorage.setItem("ocx-lang", locale); } catch { /* ignore */ }
    }
  }, [locale, committed]);

  const t: TFn = useCallback(
    (key, vars) => interpolate(catalogFor(locale)[key] ?? catalogFor("en")[key] ?? key, vars),
    [locale],
  );
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function Trans({ k, cmd, vars }: { k: TKey; cmd: string; vars?: Vars }) {
  const { t } = useI18n();
  const [pre, post = ""] = t(k, vars).split("{cmd}");
  return <>{pre}<code className="chip">{cmd}</code>{post}</>;
}
