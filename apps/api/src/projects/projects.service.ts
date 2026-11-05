import { Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectCreateInput, ProjectDto, ProjectSummaryDto, ProjectUpdateInput } from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { PlanFilesService } from '../files/plan-files.service.js';
import { toFloorDto, toProjectSummaryDto } from '../common/mappers.js';

const summaryInclude = { client: { select: { name: true } }, _count: { select: { floors: true } } } as const;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: PlanFilesService,
  ) {}

  async list(organizationId: string, filter: { clientId?: string; search?: string }): Promise<ProjectSummaryDto[]> {
    const q = filter.search?.trim();
    const projects = await this.prisma.project.findMany({
      where: {
        organizationId,
        ...(filter.clientId ? { clientId: filter.clientId } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { propertyAddress: { contains: q, mode: 'insensitive' } },
                { client: { name: { contains: q, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: summaryInclude,
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    return projects.map(toProjectSummaryDto);
  }

  async get(organizationId: string, id: string): Promise<ProjectDto> {
    const project = await this.prisma.project.findFirst({
      where: { id, organizationId },
      include: { ...summaryInclude, floors: { include: { planFile: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!project) throw new NotFoundException('Project not found.');
    return {
      ...toProjectSummaryDto(project),
      description: project.description,
      floors: project.floors.map(toFloorDto),
    };
  }

  async create(organizationId: string, input: ProjectCreateInput): Promise<ProjectDto> {
    await this.assertClient(organizationId, input.clientId);
    const project = await this.prisma.project.create({ data: { organizationId, ...input } });
    return this.get(organizationId, project.id);
  }

  async update(organizationId: string, id: string, input: ProjectUpdateInput): Promise<ProjectDto> {
    await this.assertProject(organizationId, id);
    if (input.clientId) await this.assertClient(organizationId, input.clientId);
    await this.prisma.project.update({ where: { id }, data: input });
    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.assertProject(organizationId, id);
    const floors = await this.prisma.floor.findMany({ where: { projectId: id }, select: { planFileId: true } });
    await this.prisma.project.delete({ where: { id } }); // floors cascade
    await this.files.deleteIfUnreferenced(floors.map((f) => f.planFileId));
  }

  async assertProject(organizationId: string, id: string): Promise<void> {
    const found = await this.prisma.project.count({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Project not found.');
  }

  private async assertClient(organizationId: string, clientId: string): Promise<void> {
    const found = await this.prisma.client.count({ where: { id: clientId, organizationId } });
    if (!found) throw new NotFoundException('Client not found.');
  }
}
