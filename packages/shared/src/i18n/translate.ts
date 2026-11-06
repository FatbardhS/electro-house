import { SQ_RUNTIME } from './sq-runtime.js';

/** Interface languages. Albanian is the default. */
export type UiLanguage = 'sq' | 'en';

interface Pattern {
  re: RegExp;
  names: string[];
  target: string;
  weight: number;
}

let patterns: Pattern[] | null = null;

/** Keys with {placeholders} become anchored regular expressions, most specific (most literal text) first. */
function compile(): Pattern[] {
  const list: Pattern[] = [];
  for (const [key, target] of Object.entries(SQ_RUNTIME)) {
    if (!key.includes('{')) continue;
    const names: string[] = [];
    const parts = key.split(/(\{\w+\})/);
    const src = parts
      .map((p) => {
        const m = /^\{(\w+)\}$/.exec(p);
        if (m) {
          names.push(m[1]!);
          return '(.+?)';
        }
        return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    const weight = parts.filter((p) => !/^\{\w+\}$/.test(p)).join('').length;
    list.push({ re: new RegExp(`^${src}$`, 's'), names, target, weight });
  }
  return list.sort((a, b) => b.weight - a.weight);
}

/**
 * English decimal point → Albanian decimal comma for plain numbers ("2.5" → "2,5"). Only one or two decimals:
 * "1.460" may already be an Albanian thousands separator and is left alone.
 */
function localNumber(v: string): string {
  return /^-?\d+\.\d{1,2}$/.test(v) ? v.replace('.', ',') : v;
}

/**
 * Translates a text produced in English by the shared code or the API (check messages, banners, server errors,
 * report texts). Exact matches first, then templates such as "Circuit {c}: {msg}"; the values filled into a
 * template are translated too. Unknown text is returned unchanged.
 */
export function translateText(text: string, lang: UiLanguage, depth = 0): string {
  if (lang !== 'sq' || !text) return text;
  const exact = SQ_RUNTIME[text];
  if (exact !== undefined) return exact;
  if (depth > 3) return text;
  patterns ??= compile();
  for (const p of patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const values: Record<string, string> = {};
    p.names.forEach((n, i) => (values[n] = localNumber(translateText(m[i + 1]!, lang, depth + 1))));
    return p.target.replace(/\{(\w+)\}/g, (all, n: string) => values[n] ?? all);
  }
  return text;
}

/** Number formats per language: Albanian uses 1.234,50 (same pattern as de-DE, which every runtime has). */
export function numberLocale(lang: UiLanguage): string {
  return lang === 'sq' ? 'de-DE' : 'en-US';
}
