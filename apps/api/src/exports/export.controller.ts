import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { exportOptionsSchema, type ExportOptions } from '@electro/shared';
import { AllowReadOnly, Auth, type AuthContext } from '../auth/auth-context.js';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import { ExportService } from './export.service.js';

@Controller()
export class ExportController {
  constructor(private readonly exports: ExportService) {}

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
