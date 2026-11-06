import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { SessionDto, SignInInput, SignUpInput } from '@electro/shared';
import { toApiError } from './api-error';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  /** undefined = not checked yet, null = signed out. */
  private readonly sessionState = signal<SessionDto | null | undefined>(undefined);
  readonly session = this.sessionState.asReadonly();
  readonly isSignedIn = computed(() => !!this.sessionState());

  private loading?: Promise<SessionDto | null>;

  /** Loads the current session once; later calls reuse the result. */
  ensureLoaded(): Promise<SessionDto | null> {
    const current = this.sessionState();
    if (current !== undefined) return Promise.resolve(current);
    this.loading ??= firstValueFrom(this.http.get<SessionDto>('/api/auth/me'))
      .then((s) => {
        this.sessionState.set(s);
        return s;
      })
      .catch((err) => {
        const e = toApiError(err);
        if (e.status === 401) {
          this.sessionState.set(null);
          return null;
        }
        this.loading = undefined; // allow retry after a network failure
        throw e;
      });
    return this.loading;
  }

  async signIn(input: SignInInput): Promise<void> {
    const s = await firstValueFrom(this.http.post<SessionDto>('/api/auth/sign-in', input));
    this.sessionState.set(s);
  }

  async signUp(input: SignUpInput): Promise<void> {
    const s = await firstValueFrom(this.http.post<SessionDto>('/api/auth/sign-up', input));
    this.sessionState.set(s);
  }

  async signOut(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/auth/sign-out', {}));
    } finally {
      this.markSignedOut();
      await this.router.navigate(['/sign-in']);
    }
  }

  /** Uses a session returned by the API (joining a company by invitation). */
  adopt(session: SessionDto): void {
    this.sessionState.set(session);
    this.loading = undefined;
  }

  /** Makes another of the user's companies the active one, then reloads the app on the clients page. */
  async switchOrganization(organizationId: string): Promise<void> {
    const s = await firstValueFrom(this.http.post<SessionDto>('/api/auth/switch', { organizationId }));
    this.sessionState.set(s);
    // Every page holds data of the previous company: a full reload is the simplest correct reset.
    window.location.assign('/clients');
  }

  /** Re-reads the session (e.g. after a subscription change, or when the API reports read-only mode). */
  async refresh(): Promise<void> {
    try {
      this.sessionState.set(await firstValueFrom(this.http.get<SessionDto>('/api/auth/me')));
    } catch {
      /* keep the current state; the next request will report problems */
    }
  }

  /** Called when the API reports an expired session. */
  markSignedOut(): void {
    this.sessionState.set(null);
    this.loading = undefined;
  }
}
