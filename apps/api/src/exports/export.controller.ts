import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { exportOptionsSchema, type ExportOptions } from '@electro/shared';
import { AllowReadOnly, Auth, type AuthContext } from '../auth/auth-context.js';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import { ExportService } from './export.service.js';

const dxfQuery = z.object({ floorId: z.uuid().optional() });

@Controller()
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  /** DXF of one floor (`?floorId=`), or a ZIP with one DXF per floor. */
  @Get('projects/:id/dxf')
  async dxf(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(dxfQuery)) query: z.infer<typeof dxfQuery>,
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, fileName, contentType } = await this.exports.exportDxf(auth.organizationId, id, query.floorId ?? null);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(bytes);
  }

  /** Generates the project PDF and sends it as a download. */
  @Post('projects/:id/exports')
  @AllowReadOnly()
  @HttpCode(200)
  async export(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(exportOptionsSchema)) body: ExportOptions,
    @Res() res: Response,
  ): Promise<void> {
    const { bytes, fileName } = await this.exports.exportProject(auth.organizationId, id, body);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(bytes));
  }
}
