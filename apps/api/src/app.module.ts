import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.service.js';
import { StorageModule } from './storage/storage.service.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { SessionGuard } from './auth/session.guard.js';
import { ClientsController } from './clients/clients.controller.js';
import { ClientsService } from './clients/clients.service.js';
import { ProjectsController } from './projects/projects.controller.js';
import { ProjectsService } from './projects/projects.service.js';
import { FloorsController } from './floors/floors.controller.js';
import { FloorsService } from './floors/floors.service.js';
import { PlanFilesService } from './files/plan-files.service.js';
import { DrawingController } from './drawing/drawing.controller.js';
import { DrawingService } from './drawing/drawing.service.js';
import { InstallationController } from './installation/installation.controller.js';
import { InstallationService } from './installation/installation.service.js';
import { PricingController } from './pricing/pricing.controller.js';
import { PricingService } from './pricing/pricing.service.js';
import { ExportController } from './exports/export.controller.js';
import { ExportService } from './exports/export.service.js';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    // Rate limits (stricter ones on sign-in/up). Disabled only under the automated test runner.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 600 }],
      skipIf: () => process.env['NODE_ENV'] === 'test',
    }),
  ],
  controllers: [AuthController, ClientsController, ProjectsController, FloorsController, DrawingController, InstallationController, PricingController, ExportController],
  providers: [
    AuthService,
    ClientsService,
    ProjectsService,
    FloorsService,
    PlanFilesService,
    DrawingService,
    InstallationService,
    PricingService,
    ExportService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
