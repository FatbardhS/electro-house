import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { SQ, SQ_EXTRA, type TKey } from './sq';

export type Lang = 'sq' | 'en';
export const LANGS: readonly Lang[] = ['sq', 'en'];
const STORAGE_KEY = 'eh.lang';
/**
 * Number/date locale per language. Chrome and Edge ship no Albanian Intl data (they silently fall back to
 * US formats), so Albanian uses de-DE when sq is missing: same conventions (1.234,50 € · 06.11.2026, 23:40).
 */
const LOCALE: Record<Lang, string> = {
  sq: Intl.NumberFormat.supportedLocalesOf(['sq-AL']).length ? 'sq-AL' : 'de-DE',
  en: 'en-GB',
};

export type TParams = Record<string, string | number>;

/** The app-wide instance, for code outside Angular injection (stores, sync classes, helpers). */
let current: I18n | null = null;

/** Translates a fixed text from plain code (same as I18n.t). */
export function t(key: TKey, params?: TParams): string {
  return current ? current.t(key, params) : params ? fill(key, params) : key;
}

/** Translates runtime text from plain code (same as I18n.tx). */
export function tx(text: string, params?: TParams): string {
  return current ? current.tx(text, params) : params ? fill(text, params) : text;
}

/**
 * Albanian first, English second. The English text is the key, so templates stay readable:
 * `{{ 'Sign in' | t }}` shows "Hyr" in Albanian and "Sign in" in English.
 * Every key must exist in `SQ` (type-checked), so no screen can be left half-translated.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly document = inject(DOCUMENT);
  readonly lang = signal<Lang>(readStored());

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    current = this;
    effect(() => {
      const lang = this.lang();
      this.document.documentElement.lang = lang;
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        /* storage blocked: the choice still applies to this visit */
      }
    });
  }

  set(lang: Lang): void {
    this.lang.set(lang);
  }

  /** Translates a fixed UI text. `{name}` placeholders are filled from `params`. */
  t(key: TKey, params?: TParams): string {
    const text = this.lang() === 'sq' ? SQ[key] : key;
    return params ? fill(text, params) : text;
  }

  /**
   * Translates text that is not known at compile time (server and validation messages).
   * Unknown text is shown unchanged.
   */
  tx(text: string, params?: TParams): string {
    let out = text;
    if (this.lang() === 'sq') out = (SQ as Record<string, string>)[text] ?? SQ_EXTRA[text] ?? text;
    return params ? fill(out, params) : out;
  }

  get locale(): string {
    return LOCALE[this.lang()];
  }

  /** 1 250,50 (sq) / 1,250.50 (en). */
  num(value: number, digits = 2, minDigits = digits): string {
    return new Intl.NumberFormat(this.locale, { minimumFractionDigits: minDigits, maximumFractionDigits: digits }).format(value);
  }

  money(value: number, currency = 'EUR'): string {
    return new Intl.NumberFormat(this.locale, { style: 'currency', currency }).format(value);
  }

  date(value: string | Date | null | undefined): string {
    if (!value) return '';
    return new Intl.DateTimeFormat(this.locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
  }

  dateTime(value: string | Date | null | undefined): string {
    if (!value) return '';
    return new Intl.DateTimeFormat(this.locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(
      new Date(value),
    );
  }
}

function fill(text: string, params: TParams): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

function readStored(): Lang {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'sq' || v === 'en') return v;
  } catch {
    /* ignore */
  }
  return 'sq'; // Albanian is the default for everyone
}
