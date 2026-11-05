import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { drawingPatchSchema, type DrawingDto, type DrawingPatchInput } from '@electro/shared';
import { Auth, type AuthContext } from '../auth/auth-context.js';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import { DrawingService } from './drawing.service.js';

@Controller('floors/:id/drawing')
export class DrawingController {
  constructor(private readonly drawing: DrawingService) {}

  @Get()
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<DrawingDto> {
    return this.drawing.get(auth.organizationId, id);
  }

  @Patch()
  patch(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(drawingPatchSchema)) body: DrawingPatchInput,
  ): Promise<{ revision: number }> {
    return this.drawing.patch(auth.organizationId, id, body);
  }
}
