import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  projectCreateSchema,
  projectUpdateSchema,
  type ProjectCreateInput,
  type ProjectDto,
  type ProjectSummaryDto,
  type ProjectUpdateInput,
} from '@electro/shared';
import { Auth, type AuthContext } from '../auth/auth-context.js';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import { ProjectsService } from './projects.service.js';
import { TrackActivity } from '../activity/track-activity.js';

const listProjectsQuery = z.object({
  clientId: z.uuid().optional(),
  search: z.string().trim().max(200).optional(),
});

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(listProjectsQuery)) query: z.infer<typeof listProjectsQuery>,
  ): Promise<ProjectSummaryDto[]> {
    return this.projects.list(auth.organizationId, query);
  }

  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<ProjectDto> {
    return this.projects.get(auth.organizationId, id);
  }

  @TrackActivity('project.created', { target: { type: 'project' } })
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(projectCreateSchema)) body: ProjectCreateInput,
  ): Promise<ProjectDto> {
    return this.projects.create(auth.organizationId, body);
  }

  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(projectUpdateSchema)) body: ProjectUpdateInput,
  ): Promise<ProjectDto> {
    return this.projects.update(auth.organizationId, id, body);
  }

  @TrackActivity('project.deleted', { target: { type: 'project', param: 'id' } })
  @Delete(':id')
  @HttpCode(204)
  remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.projects.remove(auth.organizationId, id);
  }
}
