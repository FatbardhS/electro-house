import { Injectable, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { I18n } from './i18n.service';
import type { TKey } from './sq';

/** Route titles are translation keys; the tab title follows the language switch. */
@Injectable()
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly i18n = inject(I18n);
  private readonly key = signal<TKey | null>(null);

  constructor() {
    super();
    effect(() => {
      const key = this.key();
      this.title.setTitle(key ? `${this.i18n.t(key)} · Electro House` : 'Electro House');
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.key.set((this.buildTitle(snapshot) as TKey | undefined) ?? null);
  }
}
