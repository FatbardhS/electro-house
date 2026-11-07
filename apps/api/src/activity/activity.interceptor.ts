import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { catchError, from, mergeMap, tap, throwError, type Observable } from 'rxjs';
import type { SessionDto } from '@electro/shared';
import type { AuthedRequest } from '../auth/auth-context.js';
import { ActivityService } from './activity.service.js';
import { TRACK_ACTIVITY_KEY, type TrackMeta } from './track-activity.js';

function isSession(value: unknown): value is SessionDto {
  return !!value && typeof value === 'object' && 'user' in value && 'organization' in value;
}

/**
 * Records routes marked with @TrackActivity once they succeed, plus failed sign-ins.
 * Recording runs after the response is decided and never changes it.
 */
@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly activity: ActivityService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<TrackMeta | undefined>(TRACK_ACTIVITY_KEY, ctx.getHandler());
    if (!meta) return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.auth;
    const params = (req.params ?? {}) as Record<string, string | undefined>;
    const targetId = meta.target?.param ? params[meta.target.param] ?? null : null;

    // Read the target's name first: after a delete it is gone.
    const before = meta.target?.param && targetId
      ? this.activity.targetName(meta.target.type, targetId, auth?.organizationId)
      : Promise.resolve(null);

    return from(before).pipe(
      mergeMap((nameBefore) =>
        next.handle().pipe(
          tap((result) => {
            const session = isSession(result) ? result : null;
            let id = targetId;
            let name = nameBefore;
            if (meta.fromResult) {
              const r = meta.fromResult(result);
              id = r.id ?? id;
              name = r.name ?? name;
            } else if (meta.target && !meta.target.param && result && typeof result === 'object') {
              const r = result as { id?: unknown; name?: unknown };
              if (typeof r.id === 'string') id = r.id;
              if (typeof r.name === 'string') name = r.name;
            }
            void this.activity.record({
              action: meta.action,
              userId: session?.user.id ?? auth?.userId ?? null,
              email: session?.user.email ?? null,
              organizationId: session?.organization.id ?? auth?.organizationId ?? null,
              organizationName: session?.organization.name ?? null,
              targetType: meta.target?.type ?? null,
              targetId: id,
              targetName: name,
              details: meta.details?.(req) ?? null,
              req,
            });
          }),
          catchError((err: unknown) => {
            // A wrong password is worth seeing (password guessing); other sign-in errors (validation, rate limit) are not.
            if (meta.action === 'auth.sign_in' && err instanceof HttpException && err.getStatus() === 401) {
              const body = req.body as { email?: unknown } | undefined;
              const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : null;
              void this.activity.record({ action: 'auth.sign_in_failed', email, req });
            }
            return throwError(() => err);
          }),
        ),
      ),
    );
  }
}
