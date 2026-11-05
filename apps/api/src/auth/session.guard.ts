import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { env } from '../config/env.js';
import { AuthService } from './auth.service.js';
import { PUBLIC_KEY, SESSION_COOKIE, type AuthedRequest } from './auth-context.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: every route needs a valid session unless marked @Public().
 * State-changing requests must also come from the web app's origin (CSRF defence on top of SameSite cookies).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();

    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && origin !== env().WEB_ORIGIN) {
        throw new ForbiddenException('Request origin not allowed.');
      }
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const auth = await this.auth.resolve(cookies?.[SESSION_COOKIE]);
    if (!auth) throw new UnauthorizedException('Your session has expired. Please sign in again.');
    req.auth = auth;
    return true;
  }
}
