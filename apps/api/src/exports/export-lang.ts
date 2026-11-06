import { AsyncLocalStorage } from 'node:async_hooks';
import { numberLocale, translateText, type UiLanguage } from '@electro/shared';

/**
 * Language of the export being generated (the language of the user who exports). Kept in async context so the
 * report writer and plan sheet can translate every text they draw without passing the language around.
 */
const store = new AsyncLocalStorage<UiLanguage>();

export function withExportLanguage<T>(lang: UiLanguage, fn: () => Promise<T>): Promise<T> {
  return store.run(lang, fn);
}

export function exportLanguage(): UiLanguage {
  return store.getStore() ?? 'en';
}

/** Translates a report text into the export language (unknown text, e.g. user data, is kept). */
export function tr(text: string): string {
  return translateText(text, exportLanguage());
}

function fmt(v: number, min: number, max: number): string {
  return v.toLocaleString(numberLocale(exportLanguage()), { minimumFractionDigits: min, maximumFractionDigits: max });
}
export const n0 = (v: number) => fmt(v, 0, 0);
export const n1 = (v: number) => fmt(v, 1, 1);
export const n2 = (v: number) => fmt(v, 2, 2);
export const q = (v: number) => fmt(v, 0, 2);
/** "1.234,50 EUR" in Albanian, "1,234.50 EUR" in English. */
export const money = (amount: number, currency: string) => `${n2(amount)} ${currency}`;
