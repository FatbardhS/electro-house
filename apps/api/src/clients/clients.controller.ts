import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { clientInputSchema, listQuerySchema, type ClientDto, type ClientInput } from '@electro/shared';
import { Auth, type AuthContext } from '../auth/auth-context.js';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import { ClientsService } from './clients.service.js';
import { TrackActivity } from '../activity/track-activity.js';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(listQuerySchema)) query: { search?: string }): Promise<ClientDto[]> {
    return this.clients.list(auth.organizationId, query.search);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<ClientDto> {
    return this.clients.get(auth.organizationId, id);
  }

  @TrackActivity('client.created', { target: { type: 'client' } })
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(clientInputSchema)) body: ClientInput): Promise<ClientDto> {
    return this.clients.create(auth.organizationId, body);
  }

  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(clientInputSchema)) body: ClientInput,
  ): Promise<ClientDto> {
    return this.clients.update(auth.organizationId, id, body);
  }

  @TrackActivity('client.deleted', { target: { type: 'client', param: 'id' } })
  @Delete(':id')
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.clients.remove(auth.organizationId, id);
  }
}
