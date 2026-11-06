import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EXAMPLE_MATERIALS,
  materialsFromCsv,
  readOrganizationSettings,
  type MaterialDto,
  type MaterialInput,
  type MaterialRuleDto,
  type MaterialRuleInput,
  type OrganizationSettings,
} from '@electro/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { Prisma, type Material, type MaterialRule } from '../generated/prisma/client.js';

export function toMaterialDto(m: Material): MaterialDto {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    unit: m.unit,
    unitPrice: m.unitPrice.toNumber(),
    packSize: m.packSize === null ? null : m.packSize.toNumber(),
    category: m.category,
    archived: m.archived,
    updatedAt: m.updatedAt.toISOString(),
  };
}

export function toRuleDto(r: MaterialRule): MaterialRuleDto {
  return {
    id: r.id,
    target: r.target,
    materialId: r.materialId,
    quantity: r.quantity.toNumber(),
    labourMinutes: r.labourMinutes.toNumber(),
  };
}

export interface CsvImportResult {
  created: number;
  updated: number;
  errors: { line: number; message: string }[];
  applied: boolean;
}

/** Company price list, material rules and company settings. Changes require the owner or admin role. */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── settings ──

  async getSettings(organizationId: string): Promise<OrganizationSettings> {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    return readOrganizationSettings(org.settings);
  }

  async setSettings(auth: AuthContext, settings: OrganizationSettings): Promise<OrganizationSettings> {
    this.assertManager(auth);
    await this.prisma.organization.update({
      where: { id: auth.organizationId },
      data: { settings: settings as unknown as Prisma.InputJsonValue },
    });
    return settings;
  }

  // ── materials ──

  async listMaterials(organizationId: string): Promise<MaterialDto[]> {
    const rows = await this.prisma.material.findMany({ where: { organizationId }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
    return rows.map(toMaterialDto);
  }

  async createMaterial(auth: AuthContext, input: MaterialInput): Promise<MaterialDto> {
    this.assertManager(auth);
    try {
      const m = await this.prisma.material.create({ data: { organizationId: auth.organizationId, ...input } });
      return toMaterialDto(m);
    } catch (e) {
      throw this.duplicateCode(e, input.code);
    }
  }

  async updateMaterial(auth: AuthContext, id: string, input: Partial<MaterialInput>): Promise<MaterialDto> {
    this.assertManager(auth);
    await this.findMaterial(auth.organizationId, id);
    try {
      const m = await this.prisma.material.update({ where: { id }, data: input });
      return toMaterialDto(m);
    } catch (e) {
      throw this.duplicateCode(e, input.code ?? null);
    }
  }

  /** Deletes an unused material. Materials used by rules must be archived instead (keeps the rules valid). */
  async deleteMaterial(auth: AuthContext, id: string): Promise<void> {
    this.assertManager(auth);
    await this.findMaterial(auth.organizationId, id);
    const used = await this.prisma.materialRule.count({ where: { materialId: id } });
    if (used) throw new ConflictException(`This material is used by ${used} rule(s). Remove those rules or archive the material instead.`);
    await this.prisma.material.delete({ where: { id } });
  }

  /** Adds the fictional example materials (skips codes that already exist). */
  async addExamples(auth: AuthContext): Promise<number> {
    this.assertManager(auth);
    const res = await this.prisma.material.createMany({
      data: EXAMPLE_MATERIALS.map((m) => ({ organizationId: auth.organizationId, ...m })),
      skipDuplicates: true,
    });
    return res.count;
  }

  /**
   * Imports a CSV price list. Rows are matched by code, or by exact name when they have no code.
   * With `apply: false` only reports what would change. Nothing is written if any row has an error.
   */
  async importCsv(auth: AuthContext, csv: string, apply: boolean): Promise<CsvImportResult> {
    this.assertManager(auth);
    const parsed = materialsFromCsv(csv);
    const existing = await this.prisma.material.findMany({ where: { organizationId: auth.organizationId } });
    const byCode = new Map(existing.filter((m) => m.code).map((m) => [m.code!, m]));
    const byName = new Map(existing.filter((m) => !m.code).map((m) => [m.name.toLowerCase(), m]));
    const plan = parsed.rows.map((r) => ({
      input: r.input,
      match: r.input.code ? byCode.get(r.input.code) : byName.get(r.input.name.toLowerCase()),
    }));
    const result: CsvImportResult = {
      created: plan.filter((p) => !p.match).length,
      updated: plan.filter((p) => p.match).length,
      errors: parsed.errors,
      applied: false,
    };
    if (!apply || parsed.errors.length || plan.length === 0) return result;
    await this.prisma.$transaction(
      plan.map((p) =>
        p.match
          ? this.prisma.material.update({ where: { id: p.match.id }, data: { ...p.input, archived: false } })
          : this.prisma.material.create({ data: { organizationId: auth.organizationId, ...p.input } }),
      ),
    );
    return { ...result, applied: true };
  }

  // ── rules ──

  async listRules(organizationId: string): Promise<MaterialRuleDto[]> {
    const rows = await this.prisma.materialRule.findMany({ where: { organizationId }, orderBy: [{ target: 'asc' }, { createdAt: 'asc' }] });
    return rows.map(toRuleDto);
  }

  async createRule(auth: AuthContext, input: MaterialRuleInput): Promise<MaterialRuleDto> {
    this.assertManager(auth);
    await this.findMaterial(auth.organizationId, input.materialId, BadRequestException);
    const r = await this.prisma.materialRule.create({ data: { organizationId: auth.organizationId, ...input } });
    return toRuleDto(r);
  }

  async updateRule(auth: AuthContext, id: string, input: Partial<MaterialRuleInput>): Promise<MaterialRuleDto> {
    this.assertManager(auth);
    await this.findRule(auth.organizationId, id);
    if (input.materialId) await this.findMaterial(auth.organizationId, input.materialId, BadRequestException);
    const r = await this.prisma.materialRule.update({ where: { id }, data: input });
    return toRuleDto(r);
  }

  async deleteRule(auth: AuthContext, id: string): Promise<void> {
    this.assertManager(auth);
    await this.findRule(auth.organizationId, id);
    await this.prisma.materialRule.delete({ where: { id } });
  }

  // ── helpers ──

  private assertManager(auth: AuthContext): void {
    if (auth.role === 'MEMBER') throw new ForbiddenException('Only the owner or an admin can change prices and company settings.');
  }

  private async findMaterial(
    organizationId: string,
    id: string,
    Err: typeof NotFoundException | typeof BadRequestException = NotFoundException,
  ): Promise<Material> {
    const m = await this.prisma.material.findFirst({ where: { id, organizationId } });
    if (!m) throw new Err('Material not found.');
    return m;
  }

  private async findRule(organizationId: string, id: string): Promise<MaterialRule> {
    const r = await this.prisma.materialRule.findFirst({ where: { id, organizationId } });
    if (!r) throw new NotFoundException('Rule not found.');
    return r;
  }

  private duplicateCode(e: unknown, code: string | null): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException(`Another material already has the code "${code}".`);
    }
    return e;
  }
}
