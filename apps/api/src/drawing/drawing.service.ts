import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LAYER_KEYS,
  defaultLayers,
  validateComponent,
  type ComponentDto,
  type DrawingDto,
  type DrawingPatchInput,
  type LayerKey,
  type WireDto,
  type CableDto,
} from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Component, Wire } from '../generated/prisma/client.js';
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

export function toWireDto(w: Wire): WireDto {
  return {
    id: w.id,
    label: w.label,
    from: { componentId: w.fromComponentId, portId: w.fromPortId, x: w.fromX, y: w.fromY },
    to: { componentId: w.toComponentId, portId: w.toPortId, x: w.toX, y: w.toY },
    points: (Array.isArray(w.points) ? w.points : []) as unknown as WireDto['points'],
    cable: w.cable as unknown as CableDto,
    circuitId: w.circuitId,
    description: w.description,
  };
}

@Injectable()
export class DrawingService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string, floorId: string): Promise<DrawingDto> {
    const floor = await this.prisma.floor.findFirst({
      where: { id: floorId, project: { organizationId } },
      include: {
        layers: true,
        components: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        wires: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
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
      wires: floor.wires.map(toWireDto),
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
    const wireUpserts = new Map<string, WireDto>();
    const wireDeletes = new Set<string>();
    for (const [i, op] of input.ops.entries()) {
      if (op.op === 'upsert') {
        const v = validateComponent(op.component as ComponentDto);
        if (!v.ok) throw new BadRequestException({ message: v.error, fields: { [`ops.${i}`]: v.error } });
        finalUpserts.set(v.value.id, v.value);
        finalDeletes.delete(v.value.id);
      } else if (op.op === 'delete') {
        finalUpserts.delete(op.id);
        finalDeletes.add(op.id);
      } else if (op.op === 'upsertWire') {
        wireUpserts.set(op.wire.id, op.wire as WireDto);
        wireDeletes.delete(op.wire.id);
      } else if (op.op === 'deleteWire') {
        wireUpserts.delete(op.id);
        wireDeletes.add(op.id);
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
    await this.checkWires(floorId, finalUpserts, finalDeletes, wireUpserts, wireDeletes);

    const revision = await this.prisma.$transaction(async (tx) => {
      const bumped = await tx.floor.updateMany({
        where: { id: floorId, drawingRevision: input.baseRevision },
        data: { drawingRevision: { increment: 1 } },
      });
      if (bumped.count === 0) {
        throw new ConflictException('This floor’s drawing was changed somewhere else. The latest version will be loaded.');
      }
      // Order keeps foreign keys valid: drop wires, write components, write wires, then drop components.
      if (wireDeletes.size) await tx.wire.deleteMany({ where: { floorId, id: { in: [...wireDeletes] } } });
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
      for (const w of wireUpserts.values()) {
        const data = {
          label: w.label,
          fromComponentId: w.from.componentId,
          fromPortId: w.from.portId,
          fromX: w.from.x,
          fromY: w.from.y,
          toComponentId: w.to.componentId,
          toPortId: w.to.portId,
          toX: w.to.x,
          toY: w.to.y,
          points: w.points as unknown as Prisma.InputJsonValue,
          cable: w.cable as unknown as Prisma.InputJsonValue,
          circuitId: w.circuitId,
          description: w.description,
        };
        await tx.wire.upsert({ where: { id: w.id }, create: { id: w.id, floorId, ...data }, update: data });
      }
      if (finalDeletes.size) {
        await tx.component.deleteMany({ where: { floorId, id: { in: [...finalDeletes] } } });
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

  /**
   * Wire consistency for a batch: wire ids are not used on another floor, connected ends point at components
   * that exist on this floor after the batch, and no component is deleted while a wire is still attached to it.
   */
  private async checkWires(
    floorId: string,
    compUpserts: Map<string, ComponentDto>,
    compDeletes: Set<string>,
    wireUpserts: Map<string, WireDto>,
    wireDeletes: Set<string>,
  ): Promise<void> {
    if (wireUpserts.size) {
      const foreign = await this.prisma.wire.findFirst({
        where: { id: { in: [...wireUpserts.keys()] }, NOT: { floorId } },
        select: { id: true },
      });
      if (foreign) throw new BadRequestException('A wire in this change belongs to a different floor.');
    }
    const referenced = new Set<string>();
    for (const w of wireUpserts.values()) {
      for (const end of [w.from, w.to]) if (end.componentId) referenced.add(end.componentId);
    }
    if (referenced.size) {
      const existing = await this.prisma.component.findMany({
        where: { floorId, id: { in: [...referenced] } },
        select: { id: true },
      });
      const present = new Set([...existing.map((c) => c.id), ...compUpserts.keys()]);
      for (const id of referenced) {
        if (!present.has(id) || compDeletes.has(id)) {
          throw new BadRequestException('A wire is connected to a component that does not exist on this floor.');
        }
      }
    }
    if (compDeletes.size) {
      const attached = await this.prisma.wire.findMany({
        where: { floorId, OR: [{ fromComponentId: { in: [...compDeletes] } }, { toComponentId: { in: [...compDeletes] } }] },
        select: { id: true },
      });
      // Still attached unless the wire is deleted or rewritten (then its new ends were checked above).
      if (attached.some((w) => !wireDeletes.has(w.id) && !wireUpserts.has(w.id))) {
        throw new BadRequestException('Disconnect or delete the wires attached to a component before deleting it.');
      }
    }
  }
}
