import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import {
  circuitInputSchema,
  circuitUpdateSchema,
  electricalProfileSchema,
  floorLinkInputSchema,
  floorLinkUpdateSchema,
  type CircuitDto,
  type CircuitInput,
  type ElectricalProfile,
  type FloorLinkDto,
  type FloorLinkInput,
  type InstallationDto,
} from '@electro/shared';
import { Auth, type AuthContext } from '../auth/auth-context.js';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import { InstallationService } from './installation.service.js';

@Controller()
export class InstallationController {
  constructor(private readonly installation: InstallationService) {}

  @Get('projects/:id/installation')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<InstallationDto> {
    return this.installation.get(auth.organizationId, id);
  }

  @Put('projects/:id/electrical-profile')
  setProfile(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(electricalProfileSchema)) body: ElectricalProfile,
  ): Promise<ElectricalProfile> {
    return this.installation.setProfile(auth.organizationId, id, body);
  }

  @Post('projects/:id/circuits')
  createCircuit(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(circuitInputSchema)) body: CircuitInput,
  ): Promise<CircuitDto> {
    return this.installation.createCircuit(auth.organizationId, id, body);
  }

  @Patch('circuits/:id')
  updateCircuit(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(circuitUpdateSchema)) body: Partial<CircuitInput>,
  ): Promise<CircuitDto> {
    return this.installation.updateCircuit(auth.organizationId, id, body);
  }

  @Delete('circuits/:id')
  @HttpCode(204)
  deleteCircuit(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.installation.deleteCircuit(auth.organizationId, id);
  }

  @Post('projects/:id/links')
  createLink(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(floorLinkInputSchema)) body: FloorLinkInput,
  ): Promise<FloorLinkDto> {
    return this.installation.createLink(auth.organizationId, id, body);
  }

  @Patch('links/:id')
  updateLink(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(floorLinkUpdateSchema)) body: Partial<FloorLinkInput>,
  ): Promise<FloorLinkDto> {
    return this.installation.updateLink(auth.organizationId, id, body);
  }

  @Delete('links/:id')
  @HttpCode(204)
  deleteLink(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.installation.deleteLink(auth.organizationId, id);
  }
}
