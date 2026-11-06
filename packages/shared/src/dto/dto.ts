import type { BillingSummary } from '../billing/billing.js';
import type { Calibration } from '../calibration/calibration.js';
import type { PlanRotation } from '../geometry/view-transform.js';
import type { ProjectStatus } from '../schemas/schemas.js';

/** Response shapes returned by the API. Dates are ISO strings. */

export interface UserDto {
  id: string;
  email: string;
  name: string;
}

export interface OrganizationDto {
  id: string;
  name: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  /** Subscription state for banners and read-only mode. */
  billing: BillingSummary;
}

export interface SessionDto {
  user: UserDto;
  /** The active company. */
  organization: OrganizationDto;
  /** Every company the user belongs to (for the company switcher). */
  organizations: { id: string; name: string; role: 'OWNER' | 'ADMIN' | 'MEMBER' }[];
}

export interface ClientDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummaryDto {
  id: string;
  clientId: string;
  clientName: string;
  name: string;
  propertyAddress: string | null;
  status: ProjectStatus;
  floorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDto extends ProjectSummaryDto {
  description: string | null;
  floors: FloorDto[];
}

export interface PlanFileDto {
  id: string;
  originalName: string;
  sizeBytes: number;
  pageCount: number;
  createdAt: string;
}

export interface FloorDto {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  planFile: PlanFileDto | null;
  planPage: number;
  planRotation: PlanRotation;
  backgroundLocked: boolean;
  calibration: Calibration | null;
  calibrationNeedsCheck: boolean;
  revision: number;
  updatedAt: string;
}

export interface PlanUrlDto {
  url: string;
  expiresAt: string;
}

/** Every API error has this body. */
export interface ApiErrorDto {
  statusCode: number;
  error: string;
  message: string;
  /** Field-level validation messages, keyed by dotted path. */
  fields?: Record<string, string>;
}
