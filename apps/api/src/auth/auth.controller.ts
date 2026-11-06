import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { setLanguageSchema, signInSchema, signUpSchema, switchOrganizationSchema, type Language, type SessionDto, type SignInInput, type SignUpInput } from '@electro/shared';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import { setSessionCookie } from './session-cookie.js';
import { AuthService } from './auth.service.js';
import { AllowReadOnly, Auth, Public, SESSION_COOKIE, type AuthContext } from './auth-context.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('sign-up')
  async signUp(
    @Body(new ZodPipe(signUpSchema)) body: SignUpInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const { token, expiresAt, session } = await this.auth.signUp(body);
    this.setCookie(res, token, expiresAt);
    return session;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('sign-in')
  @HttpCode(200)
  async signIn(
    @Body(new ZodPipe(signInSchema)) body: SignInInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const { token, expiresAt, session } = await this.auth.signIn(body);
    this.setCookie(res, token, expiresAt);
    return session;
  }

  @Post('sign-out')
  @AllowReadOnly()
  @HttpCode(204)
  async signOut(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.signOut(auth.sessionId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  me(@Auth() auth: AuthContext): Promise<SessionDto> {
    return this.auth.describe(auth);
  }

  /** Switches the active company (only to one the user belongs to). */
  @Post('switch')
  @AllowReadOnly()
  @HttpCode(200)
  switch(@Auth() auth: AuthContext, @Body(new ZodPipe(switchOrganizationSchema)) body: { organizationId: string }): Promise<SessionDto> {
    return this.auth.switchOrganization(auth, body.organizationId);
  }

  /** Saves the interface language on the account (works in read-only mode too). */
  @Post('language')
  @AllowReadOnly()
  @HttpCode(204)
  async setLanguage(@Auth() auth: AuthContext, @Body(new ZodPipe(setLanguageSchema)) body: { language: Language }): Promise<void> {
    await this.auth.setLanguage(auth.userId, body.language);
  }

  private setCookie(res: Response, token: string, expiresAt: Date) {
    setSessionCookie(res, token, expiresAt);
  }
}
