import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EMPTY_PROFILE,
  calibrationSchema,
  electricalProfileSchema,
  readProjectCostSettings,
  ISSUE_ID,
  type IgnoredIssue,
  type FloorHeightsInput,
  type ProjectCostSettings,
  type CableDto,
  type CircuitDto,
  type CircuitInput,
  type ElectricalProfile,
  type FloorLinkDto,
  type FloorLinkInput,
  type InstallationDto,
} from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth-context.js';

const MAX_IGNORED = 500;
import type { Circuit, FloorLink } from '../generated/prisma/client.js';
import { Prisma } from '../generated/prisma/client.js';
import { toComponentDto, toWireDto } from '../drawing/drawing.service.js';

function toCircuitDto(c: Circuit): CircuitDto {
  return {
    id: c.id,
    projectId: c.projectId,
    number: c.number,
    name: c.name,
    category: c.category as CircuitDto['category'],
    boardComponentId: c.boardComponentId,
    phase: c.phase as CircuitDto['phase'],
    voltage: c.voltage,
    protection: c.protection as CircuitDto['protection'],
    breakerRatingA: c.breakerRatingA,
    breakerCurve: c.breakerCurve as CircuitDto['breakerCurve'],
    rcdGroup: c.rcdGroup,
    residualCurrentMa: c.residualCurrentMa,
    cableType: c.cableType,
    crossSectionMm2: c.crossSectionMm2,
    manualLoadW: c.manualLoadW,
    description: c.description,
  };
}

function toLinkDto(l: FloorLink): FloorLinkDto {
  return {
    id: l.id,
    projectId: l.projectId,
    fromComponentId: l.fromComponentId,
    toComponentId: l.toComponentId,
    lengthM: l.lengthM,
    cable: l.cable as unknown as CableDto,
    circuitId: l.circuitId,
    description: l.description,
  };
}

/** Circuits, distribution boards, inter-floor links and the whole-project data used for calculations. */
@Injectable()
export class InstallationService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string, projectId: string): Promise<InstallationDto> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, organizationId },
      include: {
        floors: {
          orderBy: { sortOrder: 'asc' },
          include: {
            components: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            wires: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
          },
        },
        circuits: { orderBy: { createdAt: 'asc' } },
        floorLinks: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!project) throw new NotFoundException('Project not found.');
    return {
      projectId,
      floors: project.floors.map((f) => {
        const cal = f.calibration ? calibrationSchema.safeParse(f.calibration) : null;
        return {
          floorId: f.id,
          name: f.name,
          sortOrder: f.sortOrder,
          metresPerUnit: cal?.success ? cal.data.metresPerUnit : null,
          calibrationNeedsCheck: f.calibrationNeedsCheck,
          hasPlan: f.planFileId !== null,
          ceilingHeightMm: f.ceilingHeightMm,
          cableRouting: f.cableRouting === 'floor' ? 'floor' : 'ceiling',
          components: f.components.map(toComponentDto),
          wires: f.wires.map(toWireDto),
        };
      }),
      circuits: project.circuits.map(toCircuitDto),
      links: project.floorLinks.map(toLinkDto),
      profile: this.profileOf(project.settings),
      costSettings: readProjectCostSettings((project.settings as Record<string, unknown> | null)?.['costSettings']),
      ignoredIssues: this.ignoredOf(project.settings),
    };
  }

  // ── ignored validation issues ──

  /** Hides one validation issue for this project (any member). Idempotent. */
  async ignoreIssue(auth: AuthContext, projectId: string, issueId: string): Promise<IgnoredIssue[]> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId: auth.organizationId } });
    if (!project) throw new NotFoundException('Project not found.');
    const list = this.ignoredOf(project.settings);
    if (list.some((i) => i.id === issueId)) return list;
    if (list.length >= MAX_IGNORED) throw new BadRequestException(`At most ${MAX_IGNORED} issues can be ignored per project.`);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId }, select: { name: true } });
    return this.saveIgnored(project.id, project.settings, [...list, { id: issueId, ignoredBy: user.name, ignoredAt: new Date().toISOString() }]);
  }

  async restoreIssue(auth: AuthContext, projectId: string, issueId: string): Promise<IgnoredIssue[]> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId: auth.organizationId } });
    if (!project) throw new NotFoundException('Project not found.');
    return this.saveIgnored(project.id, project.settings, this.ignoredOf(project.settings).filter((i) => i.id !== issueId));
  }

  private ignoredOf(settings: unknown): IgnoredIssue[] {
    const raw = (settings as Record<string, unknown> | null)?.['ignoredIssues'];
    return Array.isArray(raw)
      ? raw.filter((i): i is IgnoredIssue => !!i && typeof i.id === 'string' && ISSUE_ID.test(i.id) && typeof i.ignoredAt === 'string')
      : [];
  }

  private async saveIgnored(projectId: string, settings: unknown, list: IgnoredIssue[]): Promise<IgnoredIssue[]> {
    const next = { ...((settings as Record<string, unknown>) ?? {}), ignoredIssues: list };
    await this.prisma.project.update({ where: { id: projectId }, data: { settings: next as unknown as Prisma.InputJsonValue } });
    return list;
  }

  // ── cost settings and floor heights (bill of materials) ──

  async setCostSettings(organizationId: string, projectId: string, cost: ProjectCostSettings): Promise<ProjectCostSettings> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found.');
    const settings = { ...((project.settings as Record<string, unknown>) ?? {}), costSettings: cost };
    await this.prisma.project.update({ where: { id: projectId }, data: { settings: settings as unknown as Prisma.InputJsonValue } });
    return cost;
  }

  /** Does not touch the floor revisions, so it never conflicts with the editor's autosave. */
  async setFloorHeights(organizationId: string, floorId: string, input: FloorHeightsInput): Promise<FloorHeightsInput> {
    const n = await this.prisma.floor.count({ where: { id: floorId, project: { organizationId } } });
    if (!n) throw new NotFoundException('Floor not found.');
    await this.prisma.floor.update({ where: { id: floorId }, data: input });
    return input;
  }

  // ── circuits ──

  async createCircuit(organizationId: string, projectId: string, input: CircuitInput): Promise<CircuitDto> {
    await this.assertProject(organizationId, projectId);
    await this.assertBoard(projectId, input.boardComponentId);
    const c = await this.prisma.circuit.create({ data: { projectId, ...input } });
    return toCircuitDto(c);
  }

  async updateCircuit(organizationId: string, id: string, input: Partial<CircuitInput>): Promise<CircuitDto> {
    const existing = await this.findCircuit(organizationId, id);
    if (input.boardComponentId !== undefined) await this.assertBoard(existing.projectId, input.boardComponentId);
    const c = await this.prisma.circuit.update({ where: { id }, data: input });
    return toCircuitDto(c);
  }

  /** Deleting a circuit unassigns its components, wires and links (they are kept). */
  async deleteCircuit(organizationId: string, id: string): Promise<void> {
    await this.findCircuit(organizationId, id);
    await this.prisma.circuit.delete({ where: { id } });
  }

  // ── inter-floor links ──

  async createLink(organizationId: string, projectId: string, input: FloorLinkInput): Promise<FloorLinkDto> {
    await this.assertProject(organizationId, projectId);
    await this.assertLinkEnds(projectId, input.fromComponentId, input.toComponentId, input.circuitId);
    const l = await this.prisma.floorLink.create({
      data: { projectId, ...input, cable: input.cable as unknown as Prisma.InputJsonValue },
    });
    return toLinkDto(l);
  }

  async updateLink(organizationId: string, id: string, input: Partial<FloorLinkInput>): Promise<FloorLinkDto> {
    const link = await this.prisma.floorLink.findFirst({ where: { id, project: { organizationId } } });
    if (!link) throw new NotFoundException('Connection not found.');
    await this.assertLinkEnds(
      link.projectId,
      input.fromComponentId ?? link.fromComponentId,
      input.toComponentId ?? link.toComponentId,
      input.circuitId === undefined ? link.circuitId : input.circuitId,
    );
    const { cable, ...rest } = input;
    const l = await this.prisma.floorLink.update({
      where: { id },
      data: { ...rest, ...(cable ? { cable: cable as unknown as Prisma.InputJsonValue } : {}) },
    });
    return toLinkDto(l);
  }

  async deleteLink(organizationId: string, id: string): Promise<void> {
    const link = await this.prisma.floorLink.findFirst({ where: { id, project: { organizationId } } });
    if (!link) throw new NotFoundException('Connection not found.');
    await this.prisma.floorLink.delete({ where: { id } });
  }

  // ── rules profile ──

  async setProfile(organizationId: string, projectId: string, profile: ElectricalProfile): Promise<ElectricalProfile> {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, organizationId } });
    if (!project) throw new NotFoundException('Project not found.');
    const settings = { ...((project.settings as Record<string, unknown>) ?? {}), electricalProfile: profile };
    await this.prisma.project.update({ where: { id: projectId }, data: { settings: settings as unknown as Prisma.InputJsonValue } });
    return profile;
  }

  private profileOf(settings: unknown): ElectricalProfile {
    const raw = (settings as Record<string, unknown> | null)?.['electricalProfile'];
    const parsed = electricalProfileSchema.safeParse(raw);
    return parsed.success ? parsed.data : EMPTY_PROFILE;
  }

  // ── checks ──

  private async assertProject(organizationId: string, projectId: string): Promise<void> {
    const n = await this.prisma.project.count({ where: { id: projectId, organizationId } });
    if (!n) throw new NotFoundException('Project not found.');
  }

  private async findCircuit(organizationId: string, id: string): Promise<Circuit> {
    const c = await this.prisma.circuit.findFirst({ where: { id, project: { organizationId } } });
    if (!c) throw new NotFoundException('Circuit not found.');
    return c;
  }

  private async assertBoard(projectId: string, boardId: string | null): Promise<void> {
    if (!boardId) return;
    const board = await this.prisma.component.findFirst({
      where: { id: boardId, floor: { projectId } },
      select: { typeKey: true },
    });
    if (!board) throw new BadRequestException('The distribution board is not part of this project.');
    if (!board.typeKey.startsWith('board.')) throw new BadRequestException('Circuits can only be fed from a distribution board.');
  }

  private async assertLinkEnds(projectId: string, fromId: string, toId: string, circuitId: string | null): Promise<void> {
    if (fromId === toId) throw new BadRequestException('A connection needs two different components.');
    const ends = await this.prisma.component.findMany({
      where: { id: { in: [fromId, toId] }, floor: { projectId } },
      select: { id: true, floorId: true },
    });
    if (ends.length !== 2) throw new BadRequestException('Both connected components must be part of this project.');
    if (ends[0]!.floorId === ends[1]!.floorId) {
      throw new BadRequestException('Use a wire for connections on the same floor; floor connections join two floors.');
    }
    if (circuitId) {
      const n = await this.prisma.circuit.count({ where: { id: circuitId, projectId } });
      if (!n) throw new BadRequestException('The circuit is not part of this project.');
    }
  }
}
