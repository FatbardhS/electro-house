import type { AccessLevel } from '@electro/shared';
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

/** Identity of the signed-in user for one request. `organizationId` scopes every data query. */
export interface AuthContext {
  sessionId: string;
  userId: string;
  organizationId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  /** "read-only" when the company's subscription is not active: changes are refused with 402. */
  access: AccessLevel;
}

export type AuthedRequest = Request & { auth?: AuthContext };

export const SESSION_COOKIE = 'eh_session';

const IS_PUBLIC = 'isPublic';
export const PUBLIC_KEY = IS_PUBLIC;

/** Marks a route as reachable without a session (sign in, sign up). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_READ_ONLY_KEY = 'allowReadOnly';
/**
 * Marks a state-changing route that stays available when the subscription is inactive
 * (sign out, PDF export, billing itself). Everything else that changes data is refused with 402.
 */
export const AllowReadOnly = () => SetMetadata(ALLOW_READ_ONLY_KEY, true);

/** Injects the current `AuthContext`. Only valid on routes protected by the session guard. */
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new Error('Auth context missing: route is not behind SessionGuard');
  return req.auth;
});
