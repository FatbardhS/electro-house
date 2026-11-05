import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LAYER_KEYS,
  defaultLayers,
  validateComponent,
  type ComponentDto,
  type DrawingDto,
  type DrawingPatchInput,
  type LayerKey,
} from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Component } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';

export function toComponentDto(c: Component): ComponentDto {
  return {
    id: c.id,
    typeKey: c.typeKey,
    typeVersion: c.typeVersion,
    layerKey: (LAYER_KEYS as readonly string[]).includes(c.layerKey) ? (c.layerKey as LayerKey) : 'annotations',
    label: c.label,
    x: c.x,
    y: c.y,
    rotation: c.rotation,
    mountHeightMm: c.mountHeightMm,
    description: c.description,
    properties: (c.properties ?? {}) as Record<string, unknown>,
  };
}

@Injectable()
export class DrawingService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string, floorId: string): Promise<DrawingDto> {
    const floor = await this.prisma.floor.findFirst({
      where: { id: floorId, project: { organizationId } },
      include: { layers: true, components: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!floor) throw new NotFoundException('Floor not found.');
    const stored = new Map(floor.layers.map((l) => [l.key, l]));
    return {
      floorId: floor.id,
      revision: floor.drawingRevision,
      layers: defaultLayers().map((d) => {
        const s = stored.get(d.key);
        return s ? { key: d.key, visible: s.visible, locked: s.locked } : d;
      }),
      components: floor.components.map(toComponentDto),
    };
  }

  /**
   * Applies a batch of drawing operations atomically. Optimistic concurrency: the batch only applies
   * when the floor's drawing is still at `baseRevision`; otherwise 409 and nothing changes.
   */
  async patch(organizationId: string, floorId: string, input: DrawingPatchInput): Promise<{ revision: number }> {
    const floor = await this.prisma.floor.findFirst({
      where: { id: floorId, project: { organizationId } },
      select: { id: true, projectId: true },
    });
    if (!floor) throw new NotFoundException('Floor not found.');

    // Validate everything before touching the database. Later ops on the same component win.
    const finalUpserts = new Map<string, ComponentDto>();
    const finalDeletes = new Set<string>();
    const layers: { key: LayerKey; visible?: boolean; locked?: boolean }[] = [];
    for (const [i, op] of input.ops.entries()) {
      if (op.op === 'upsert') {
        const v = validateComponent(op.component as ComponentDto);
        if (!v.ok) throw new BadRequestException({ message: v.error, fields: { [`ops.${i}`]: v.error } });
        finalUpserts.set(v.value.id, v.value);
        finalDeletes.delete(v.value.id);
      } else if (op.op === 'delete') {
        finalUpserts.delete(op.id);
        finalDeletes.add(op.id);
      } else {
        layers.push(op);
      }
    }

    const ids = [...finalUpserts.keys()];
    if (ids.length) {
      const foreign = await this.prisma.component.findFirst({
        where: { id: { in: ids }, NOT: { floorId } },
        select: { id: true },
      });
      if (foreign) throw new BadRequestException('A component in this change belongs to a different floor.');
    }

    const revision = await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.floor.updateMany({
        where: { id: floorId, drawingRevision: input.baseRevision },
        data: { drawingRevision: { increment: 1 } },
      });
      if (bumped.count === 0) {
        throw new ConflictException('This floor’s drawing was changed somewhere else. The latest version will be loaded.');
      }
      if (finalDeletes.size) {
        await tx.component.deleteMany({ where: { floorId, id: { in: [...finalDeletes] } } });
      }
      for (const c of finalUpserts.values()) {
        const data = {
          typeKey: c.typeKey,
          typeVersion: c.typeVersion,
          layerKey: c.layerKey,
          label: c.label,
          x: c.x,
          y: c.y,
          rotation: c.rotation,
          mountHeightMm: c.mountHeightMm,
          description: c.description,
          properties: c.properties as Prisma.InputJsonValue,
        };
        await tx.component.upsert({ where: { id: c.id }, create: { id: c.id, floorId, ...data }, update: data });
      }
      for (const l of layers) {
        await tx.layer.upsert({
          where: { floorId_key: { floorId, key: l.key } },
          create: { floorId, key: l.key, visible: l.visible ?? true, locked: l.locked ?? false },
          update: { ...(l.visible !== undefined ? { visible: l.visible } : {}), ...(l.locked !== undefined ? { locked: l.locked } : {}) },
        });
      }
      const f = await tx.floor.findUniqueOrThrow({ where: { id: floorId }, select: { drawingRevision: true } });
      return f.drawingRevision;
    });
    await this.prisma.project.update({ where: { id: floor.projectId }, data: { updatedAt: new Date() } });
    return { revision };
  }
}
