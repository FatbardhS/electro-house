import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import {
  INVITATION_TOKEN,
  invitationSignUpSchema,
  inviteSchema,
  roleChangeSchema,
  transferOwnershipSchema,
  type CreatedInvitationDto,
  type InvitationPreviewDto,
  type InvitationSignUpInput,
  type InviteInput,
  type SessionDto,
  type TeamDto,
} from '@electro/shared';
import { AllowReadOnly, Auth, Public, SESSION_COOKIE, type AuthContext } from '../auth/auth-context.js';
import { AuthService } from '../auth/auth.service.js';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import { setSessionCookie } from '../auth/session-cookie.js';
import { TeamService } from './team.service.js';

const tokenParam = z.string().regex(INVITATION_TOKEN, 'This invitation link is not valid.');

@Controller('team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  get(@Auth() auth: AuthContext): Promise<TeamDto> {
    return this.team.get(auth);
  }

  /** Refused with 402 while the subscription is inactive (like every change). */
  @Post('invitations')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  invite(@Auth() auth: AuthContext, @Body(new ZodPipe(inviteSchema)) body: InviteInput): Promise<CreatedInvitationDto> {
    return this.team.invite(auth, body);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  revoke(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.team.revoke(auth, id);
  }

  @Patch('members/:userId')
  @HttpCode(204)
  changeRole(
    @Auth() auth: AuthContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodPipe(roleChangeSchema)) body: z.infer<typeof roleChangeSchema>,
  ): Promise<void> {
    return this.team.changeRole(auth, userId, body.role);
  }

  /** Removing people stays possible while read-only (it lowers the bill). */
  @Delete('members/:userId')
  @AllowReadOnly()
  remove(@Auth() auth: AuthContext, @Param('userId', ParseUUIDPipe) userId: string): Promise<{ seatsError: string | null }> {
    return this.team.remove(auth, userId);
  }

  @Post('leave')
  @AllowReadOnly()
  @HttpCode(204)
  async leave(@Auth() auth: AuthContext, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.team.leave(auth);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Post('transfer-ownership')
  @HttpCode(204)
  transfer(@Auth() auth: AuthContext, @Body(new ZodPipe(transferOwnershipSchema)) body: { userId: string }): Promise<void> {
    return this.team.transferOwnership(auth, body.userId);
  }
}

/** The invitation link, used by the invitee (signed in or not). */
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly team: TeamService,
    private readonly auth: AuthService,
  ) {}

  @Get(':token')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  preview(@Param('token', new ZodPipe(tokenParam)) token: string): Promise<InvitationPreviewDto> {
    return this.team.preview(token);
  }

  /** Joining is allowed even when the user's current company is read-only. */
  @Post(':token/accept')
  @AllowReadOnly()
  @HttpCode(200)
  async accept(@Auth() auth: AuthContext, @Param('token', new ZodPipe(tokenParam)) token: string): Promise<SessionDto> {
    const organizationId = await this.team.accept(auth, token);
    return this.auth.switchOrganization(auth, organizationId);
  }

  @Post(':token/sign-up')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signUp(
    @Param('token', new ZodPipe(tokenParam)) token: string,
    @Body(new ZodPipe(invitationSignUpSchema)) body: InvitationSignUpInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionDto> {
    const { token: sessionToken, expiresAt, session } = await this.team.signUpAndAccept(token, body);
    setSessionCookie(res, sessionToken, expiresAt);
    return session;
  }
}
