import {
  calibrationSchema,
  normalizeRotation,
  type ClientDto,
  type FloorDto,
  type PlanFileDto,
  type ProjectSummaryDto,
} from '@electro/shared';
import type { Client, Floor, Project, StoredFile } from '../generated/prisma/client.js';

export function toClientDto(c: Client & { _count: { projects: number } }): ClientDto {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: c.phone,
    address: c.address,
    notes: c.notes,
    projectCount: c._count.projects,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toProjectSummaryDto(
  p: Project & { client: { name: string }; _count: { floors: number } },
): ProjectSummaryDto {
  return {
    id: p.id,
    clientId: p.clientId,
    clientName: p.client.name,
    name: p.name,
    propertyAddress: p.propertyAddress,
    status: p.status,
    floorCount: p._count.floors,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toPlanFileDto(f: StoredFile): PlanFileDto {
  return {
    id: f.id,
    originalName: f.originalName,
    sizeBytes: f.sizeBytes,
    pageCount: f.pageCount,
    createdAt: f.createdAt.toISOString(),
  };
}

export function toFloorDto(f: Floor & { planFile: StoredFile | null }): FloorDto {
  // Stored JSON is re-validated on the way out; corrupted calibration is treated as "not calibrated".
  const calibration = f.calibration === null ? null : calibrationSchema.safeParse(f.calibration);
  return {
    id: f.id,
    projectId: f.projectId,
    name: f.name,
    sortOrder: f.sortOrder,
    planFile: f.planFile ? toPlanFileDto(f.planFile) : null,
    planPage: f.planPage,
    planRotation: normalizeRotation(f.planRotation),
    backgroundLocked: f.backgroundLocked,
    calibration: calibration?.success ? calibration.data : null,
    calibrationNeedsCheck: f.calibrationNeedsCheck,
    revision: f.revision,
    updatedAt: f.updatedAt.toISOString(),
  };
}
