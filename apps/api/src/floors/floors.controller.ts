import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  MAX_PLAN_FILE_BYTES,
  floorCreateSchema,
  floorRenameSchema,
  floorReorderSchema,
  floorSettingsSchema,
  type FloorCreateInput,
  type FloorDto,
  type FloorSettingsInput,
  type PlanUrlDto,
} from '@electro/shared';
import { Auth, type AuthContext } from '../auth/auth-context.js';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import type { UploadedPdf } from '../files/plan-files.service.js';
import { FloorsService } from './floors.service.js';

@Controller()
export class FloorsController {
  constructor(private readonly floors: FloorsService) {}

  @Post('projects/:projectId/floors')
  create(
    @Auth() auth: AuthContext,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodPipe(floorCreateSchema)) body: FloorCreateInput,
  ): Promise<FloorDto> {
    return this.floors.create(auth.organizationId, projectId, body);
  }

  @Put('projects/:projectId/floors/order')
  reorder(
    @Auth() auth: AuthContext,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodPipe(floorReorderSchema)) body: { floorIds: string[] },
  ): Promise<FloorDto[]> {
    return this.floors.reorder(auth.organizationId, projectId, body.floorIds);
  }

  @Get('floors/:id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<FloorDto> {
    return this.floors.get(auth.organizationId, id);
  }

  @Patch('floors/:id/name')
  rename(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(floorRenameSchema)) body: { name: string },
  ): Promise<FloorDto> {
    return this.floors.rename(auth.organizationId, id, body.name);
  }

  @Patch('floors/:id/settings')
  updateSettings(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(floorSettingsSchema)) body: FloorSettingsInput,
  ): Promise<FloorDto> {
    return this.floors.updateSettings(auth.organizationId, id, body);
  }

  @Put('floors/:id/plan')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PLAN_FILE_BYTES, files: 1 } }))
  uploadPlan(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedPdf | undefined,
  ): Promise<FloorDto> {
    return this.floors.uploadPlan(auth.organizationId, id, file);
  }

  @Get('floors/:id/plan-url')
  planUrl(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<PlanUrlDto> {
    return this.floors.planUrl(auth.organizationId, id);
  }

  /** Streams the plan PDF when using the local storage driver (development). Supports HTTP Range for PDF.js. */
  @Get('floors/:id/plan')
  async plan(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const path = await this.floors.localPlanPath(auth.organizationId, id);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path, { dotfiles: 'allow', headers: { 'Content-Type': 'application/pdf' } });
  }

  @Delete('floors/:id')
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.floors.remove(auth.organizationId, id);
  }
}
