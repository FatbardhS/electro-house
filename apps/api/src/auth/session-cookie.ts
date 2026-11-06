import type { Response } from 'express';
import { env } from '../config/env.js';
import { SESSION_COOKIE } from './auth-context.js';

/** The httpOnly session cookie (SameSite=Lax; Secure in production). */
export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().NODE_ENV === 'production',
    expires: expiresAt,
    path: '/',
  });
}
