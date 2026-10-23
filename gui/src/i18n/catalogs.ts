import { en, type TKey } from "./en";
import { LAB_CATALOG_OVERRIDES, type LabLocale } from "./lab-translations";

export type Locale = LabLocale;
export type Catalog = Record<TKey, string>;
export type { TKey };

// Picker labels stay available before the corresponding catalog is downloaded.
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English", de: "Deutsch", fr: "Français", ko: "한국어", zh: "中文",
  "zh-TW": "繁體中文", ru: "Русский", ja: "日本語", tr: "Türkçe", vi: "Tiếng Việt", pt: "Português",
};

const english: Catalog = { ...en, ...LAB_CATALOG_OVERRIDES.en };
const catalogs: Partial<Record<Locale, Catalog>> = { en: english };
const flights = new Map<Locale, Promise<Catalog>>();
const loaders: Record<Exclude<Locale, "en">, () => Promise<Catalog>> = {
  de: () => import("./de").then(m => m.de),
  fr: () => import("./fr").then(m => m.fr),
  ko: () => import("./ko").then(m => m.ko),
  zh: () => import("./zh").then(m => m.zh),
  "zh-TW": () => import("./zh-TW").then(m => m.zhTW),
  ru: () => import("./ru").then(m => m.ru),
  ja: () => import("./ja").then(m => m.ja),
  tr: () => import("./tr").then(m => m.tr),
  vi: () => import("./vi").then(m => m.vi),
  pt: () => import("./pt").then(m => m.pt),
};

export function loadedCatalog(locale: Locale): Catalog | undefined {
  return catalogs[locale];
}

export function loadCatalog(locale: Locale): Promise<Catalog> {
  const cached = catalogs[locale];
  if (cached) return Promise.resolve(cached);
  const existing = flights.get(locale);
  if (existing) return existing;
  const flight = loaders[locale as Exclude<Locale, "en">]().then(catalog => {
    const result = { ...catalog, ...LAB_CATALOG_OVERRIDES[locale] };
    catalogs[locale] = result;
    return result;
  }).finally(() => { flights.delete(locale); });
  flights.set(locale, flight);
  return flight;
}

export function catalogFor(locale: Locale): Catalog {
  return catalogs[locale] ?? english;
}

export function localeDisplayName(locale: Locale): string {
  return LOCALE_NAMES[locale];
}
