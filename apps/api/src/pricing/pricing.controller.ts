import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import {
  materialInputSchema,
  materialRuleInputSchema,
  materialRuleUpdateSchema,
  materialsToCsv,
  materialUpdateSchema,
  organizationSettingsSchema,
  type MaterialDto,
  type MaterialInput,
  type MaterialRuleDto,
  type MaterialRuleInput,
  type OrganizationSettings,
} from '@electro/shared';
import { Auth, type AuthContext } from '../auth/auth-context.js';
import { ZodPipe } from '../common/zod-validation.pipe.js';
import { PricingService, type CsvImportResult } from './pricing.service.js';

const importSchema = z.object({
  csv: z.string().min(1, 'The file is empty.').max(1_500_000, 'The file is too large (max 1.5 MB).'),
  apply: z.boolean(),
});

@Controller()
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get('organization/settings')
  getSettings(@Auth() auth: AuthContext): Promise<OrganizationSettings> {
    return this.pricing.getSettings(auth.organizationId);
  }

  @Put('organization/settings')
  setSettings(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(organizationSettingsSchema)) body: OrganizationSettings,
  ): Promise<OrganizationSettings> {
    return this.pricing.setSettings(auth, body);
  }

  @Get('materials')
  listMaterials(@Auth() auth: AuthContext): Promise<MaterialDto[]> {
    return this.pricing.listMaterials(auth.organizationId);
  }

  @Get('materials/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="price-list.csv"')
  async exportMaterials(@Auth() auth: AuthContext): Promise<string> {
    // BOM so spreadsheet programs read the file as UTF-8 (×, ², accented names).
    return '﻿' + materialsToCsv(await this.pricing.listMaterials(auth.organizationId));
  }

  @Post('materials')
  createMaterial(@Auth() auth: AuthContext, @Body(new ZodPipe(materialInputSchema)) body: MaterialInput): Promise<MaterialDto> {
    return this.pricing.createMaterial(auth, body);
  }

  @Post('materials/import')
  @HttpCode(200)
  importMaterials(@Auth() auth: AuthContext, @Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>): Promise<CsvImportResult> {
    return this.pricing.importCsv(auth, body.csv, body.apply);
  }

  @Post('materials/examples')
  @HttpCode(200)
  async addExamples(@Auth() auth: AuthContext): Promise<{ added: number }> {
    return { added: await this.pricing.addExamples(auth) };
  }

  @Patch('materials/:id')
  updateMaterial(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(materialUpdateSchema)) body: Partial<MaterialInput>,
  ): Promise<MaterialDto> {
    return this.pricing.updateMaterial(auth, id, body);
  }

  @Delete('materials/:id')
  @HttpCode(204)
  deleteMaterial(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.pricing.deleteMaterial(auth, id);
  }

  @Get('material-rules')
  listRules(@Auth() auth: AuthContext): Promise<MaterialRuleDto[]> {
    return this.pricing.listRules(auth.organizationId);
  }

  @Post('material-rules')
  createRule(@Auth() auth: AuthContext, @Body(new ZodPipe(materialRuleInputSchema)) body: MaterialRuleInput): Promise<MaterialRuleDto> {
    return this.pricing.createRule(auth, body);
  }

  @Patch('material-rules/:id')
  updateRule(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(materialRuleUpdateSchema)) body: Partial<MaterialRuleInput>,
  ): Promise<MaterialRuleDto> {
    return this.pricing.updateRule(auth, id, body);
  }

  @Delete('material-rules/:id')
  @HttpCode(204)
  deleteRule(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.pricing.deleteRule(auth, id);
  }
}
