import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18n, type TParams } from './i18n.service';
import type { TKey } from './sq';

/**
 * `{{ 'Sign in' | t }}`, `{{ 'Delete {name}?' | t: { name: c.name } }}`.
 * Impure so a language switch updates every text at once (the lookup is a plain object read).
 */
@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(key: TKey, params?: TParams): string {
    return this.i18n.t(key, params);
  }
}

/** For text not known at compile time (server/validation messages): `{{ err | tx }}`. */
@Pipe({ name: 'tx', pure: false })
export class TxPipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(text: string | null | undefined, params?: TParams): string {
    return text ? this.i18n.tx(text, params) : '';
  }
}

/** Locale-aware numbers: `{{ 4 | num: 2 }}` → "4,00" in Albanian. */
@Pipe({ name: 'num', pure: false })
export class NumPipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(value: number | null | undefined, digits = 2, minDigits = digits): string {
    return value === null || value === undefined || Number.isNaN(value) ? '–' : this.i18n.num(value, digits, minDigits);
  }
}

@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(value: number | null | undefined, currency = 'EUR'): string {
    return value === null || value === undefined ? '–' : this.i18n.money(value, currency);
  }
}

@Pipe({ name: 'ldate', pure: false })
export class LDatePipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(value: string | Date | null | undefined, withTime = false): string {
    return withTime ? this.i18n.dateTime(value) : this.i18n.date(value);
  }
}

export const I18N_PIPES = [TPipe, TxPipe, NumPipe, MoneyPipe, LDatePipe] as const;
