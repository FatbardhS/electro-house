import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { FloorCreateInput, FloorDto, FloorSettingsInput, PlanUrlDto } from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { PlanFilesService, type UploadedPdf } from '../files/plan-files.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { toFloorDto } from '../common/mappers.js';
import { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class FloorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly files: PlanFilesService,
    private readonly projects: ProjectsService,
  ) {}

  async get(organizationId: string, id: string): Promise<FloorDto> {
    return toFloorDto(await this.find(organizationId, id));
  }

  async create(organizationId: string, projectId: string, input: FloorCreateInput): Promise<FloorDto> {
    await this.projects.assertProject(organizationId, projectId);
    const last = await this.prisma.floor.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    const floor = await this.prisma.floor.create({
      data: { projectId, name: input.name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      include: { planFile: true },
    });
    await this.touchProject(projectId);
    return toFloorDto(floor);
  }

  async rename(organizationId: string, id: string, name: string): Promise<FloorDto> {
    const floor = await this.find(organizationId, id);
    const updated = await this.prisma.floor.update({ where: { id }, data: { name }, include: { planFile: true } });
    await this.touchProject(floor.projectId);
    return toFloorDto(updated);
  }

  /** Sets the floor order. `floorIds` must list every floor of the project exactly once. */
  async reorder(organizationId: string, projectId: string, floorIds: string[]): Promise<FloorDto[]> {
    await this.projects.assertProject(organizationId, projectId);
    const existing = await this.prisma.floor.findMany({ where: { projectId }, select: { id: true } });
    const known = new Set(existing.map((f) => f.id));
    if (floorIds.length !== known.size || new Set(floorIds).size !== floorIds.length || !floorIds.every((id) => known.has(id))) {
      throw new BadRequestException('The floor list is out of date. Reload the project and try again.');
    }
    await this.prisma.$transaction(
      floorIds.map((id, index) => this.prisma.floor.update({ where: { id }, data: { sortOrder: index } })),
    );
    await this.touchProject(projectId);
    const floors = await this.prisma.floor.findMany({
      where: { projectId },
      include: { planFile: true },
      orderBy: { sortOrder: 'asc' },
    });
    return floors.map(toFloorDto);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    const floor = await this.find(organizationId, id);
    await this.prisma.floor.delete({ where: { id } });
    await this.files.deleteIfUnreferenced([floor.planFileId]);
    await this.touchProject(floor.projectId);
  }

  /**
   * Saves editor settings (page, rotation, lock, calibration). Optimistic concurrency:
   * the update only applies if the floor is still at `baseRevision`, otherwise 409.
   */
  async updateSettings(organizationId: string, id: string, input: FloorSettingsInput): Promise<FloorDto> {
    const floor = await this.find(organizationId, id);
    const { baseRevision, calibration, ...rest } = input;

    if (rest.planPage !== undefined) {
      const pages = floor.planFile?.pageCount ?? 1;
      if (rest.planPage > pages) throw new BadRequestException(`The plan has only ${pages} page(s).`);
    }

    const data: Prisma.FloorUpdateManyMutationInput = { ...rest, revision: { increment: 1 } };
    if (calibration !== undefined) {
      data.calibration = calibration === null ? Prisma.DbNull : calibration;
      // A fresh calibration clears the "needs checking" flag unless the client says otherwise.
      if (rest.calibrationNeedsCheck === undefined) data.calibrationNeedsCheck = false;
    }

    const result = await this.prisma.floor.updateMany({ where: { id, revision: baseRevision }, data });
    if (result.count === 0) {
      throw new ConflictException('This floor was changed somewhere else. The latest version has been loaded.');
    }
    return this.get(organizationId, id);
  }

  /** Uploads or replaces the floor's plan PDF. Existing drawing data is kept; calibration is flagged for checking. */
  async uploadPlan(organizationId: string, id: string, file: UploadedPdf | undefined): Promise<FloorDto> {
    const floor = await this.find(organizationId, id);
    const stored = await this.files.store(organizationId, file);
    const hadPlan = floor.planFileId !== null;

    const updated = await this.prisma.floor.update({
      where: { id },
      data: {
        planFileId: stored.id,
        planPage: Math.min(floor.planPage, stored.pageCount),
        calibrationNeedsCheck: hadPlan && floor.calibration !== null,
        revision: { increment: 1 },
      },
      include: { planFile: true },
    });
    await this.files.deleteIfUnreferenced([floor.planFileId]);
    await this.touchProject(floor.projectId);
    return toFloorDto(updated);
  }

  /** Where the editor loads the plan PDF from: a presigned S3 URL, or the API itself with local storage. */
  async planUrl(organizationId: string, id: string): Promise<PlanUrlDto> {
    const floor = await this.find(organizationId, id);
    if (!floor.planFile) throw new NotFoundException('This floor has no plan uploaded yet.');
    const location = await this.storage.readLocation(floor.planFile.storageKey);
    if (location.kind === 'url') return { url: location.url, expiresAt: location.expiresAt.toISOString() };
    return {
      url: `/api/floors/${id}/plan?f=${floor.planFile.id}`, // file id busts the browser cache after a replace
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
  }

  /** Local storage driver only: absolute path of the plan file, for streaming with Range support. */
  async localPlanPath(organizationId: string, id: string): Promise<string> {
    const floor = await this.find(organizationId, id);
    if (!floor.planFile) throw new NotFoundException('This floor has no plan uploaded yet.');
    const location = await this.storage.readLocation(floor.planFile.storageKey);
    if (location.kind !== 'local') throw new NotFoundException('Plans are served from object storage.');
    return location.absolutePath;
  }

  /** Loads a floor, enforcing that it belongs to the caller's organization. */
  private async find(organizationId: string, id: string) {
    const floor = await this.prisma.floor.findFirst({
      where: { id, project: { organizationId } },
      include: { planFile: true },
    });
    if (!floor) throw new NotFoundException('Floor not found.');
    return floor;
  }

  private async touchProject(projectId: string): Promise<void> {
    await this.prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });
  }
}
