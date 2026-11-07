import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Routes that need a signed-in user. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    const session = await auth.ensureLoaded();
    return session ? true : router.createUrlTree(['/sign-in'], { queryParams: { next: state.url } });
  } catch {
    // Server unreachable: let the page load and show its own error state rather than bouncing to sign-in.
    return true;
  }
};

/** The product owner panel: only for accounts the server marks as platform admin. */
export const platformAdminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    const session = await auth.ensureLoaded();
    if (!session) return router.createUrlTree(['/sign-in'], { queryParams: { next: '/admin' } });
    return session.user.isPlatformAdmin ? true : router.createUrlTree(['/clients']);
  } catch {
    return router.createUrlTree(['/clients']);
  }
};

/** Matches only for visitors who are not signed in (the landing page at "/"). */
export const visitorMatch: CanMatchFn = async () => {
  const auth = inject(AuthService);
  try {
    return !(await auth.ensureLoaded());
  } catch {
    return true; // server unreachable: the landing page still works
  }
};

/** Sign-in / sign-up pages: skip them when already signed in. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  try {
    return (await auth.ensureLoaded()) ? router.createUrlTree(['/clients']) : true;
  } catch {
    return true;
  }
};

/** A 401 from any API call (other than the session probe) means the session expired: go to sign-in. */
export const sessionExpiredInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: unknown) => {
      const isAuthCall = req.url.startsWith('/api/auth/');
      if (err instanceof HttpErrorResponse && err.status === 401 && !isAuthCall) {
        auth.markSignedOut();
        void router.navigate(['/sign-in'], { queryParams: { next: router.url } });
      }
      // 402: the subscription just became inactive; refresh the session so banners and read-only mode appear.
      if (err instanceof HttpErrorResponse && err.status === 402 && auth.session()?.organization.billing.access !== 'read-only') {
        void auth.refresh();
      }
      return throwError(() => err);
    }),
  );
};
