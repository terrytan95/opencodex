import { loadCatalog, LOCALE_NAMES, type Catalog, type Locale } from "../../src/i18n/catalogs";

export const DICTS = Object.fromEntries(await Promise.all(
  (Object.keys(LOCALE_NAMES) as Locale[]).map(async locale => [locale, await loadCatalog(locale)]),
)) as Record<Locale, Catalog>;
export type { Locale };
