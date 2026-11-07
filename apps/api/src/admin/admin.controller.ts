import { CanActivate, Controller, ExecutionContext, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import {
  activityQuerySchema,
  adminListQuerySchema,
  type ActivityPageDto,
  type ActivityQuery,
  type AdminCompanyDto,
  type AdminOverviewDto,
  type AdminUserDetailDto,
  type AdminUserDto,
} from '@electro/shared';
import type { AuthedRequest } from '../auth/auth-context.js';
import { isPlatformAdmin } from '../auth/auth.service.js';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { AdminService } from './admin.service.js';

/**
 * Only product owner accounts (PLATFORM_ADMIN_EMAILS) pass. Everyone else gets 404, so the panel's existence is not
 * revealed, and the attempt is logged.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const auth = req.auth;
    if (!auth) throw new NotFoundException();
    const user = await this.prisma.user.findUnique({ where: { id: auth.userId }, select: { email: true } });
    if (user && isPlatformAdmin(user.email)) return true;
    void this.activity.record({ action: 'admin.denied', userId: auth.userId, email: user?.email, organizationId: auth.organizationId, req });
    throw new NotFoundException();
  }
}

@Controller('admin')
@UseGuards(PlatformAdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview(): Promise<AdminOverviewDto> {
    return this.admin.overview();
  }

  @Get('users')
  users(@Query(new ZodPipe(adminListQuerySchema)) q: { search?: string }): Promise<AdminUserDto[]> {
    return this.admin.users(q.search || undefined);
  }

  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDetailDto> {
    return this.admin.user(id);
  }

  @Get('companies')
  companies(@Query(new ZodPipe(adminListQuerySchema)) q: { search?: string }): Promise<AdminCompanyDto[]> {
    return this.admin.companies(q.search || undefined);
  }

  @Get('activity')
  activity(@Query(new ZodPipe(activityQuerySchema)) q: ActivityQuery): Promise<ActivityPageDto> {
    return this.admin.activity({ ...q, search: q.search || undefined });
  }
}
