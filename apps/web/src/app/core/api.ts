import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { filter, firstValueFrom, map, type Observable } from 'rxjs';
import type {
  CircuitDto,
  CircuitInput,
  ClientDto,
  DrawingDto,
  ElectricalProfile,
  ExportOptions,
  FloorHeightsInput,
  IgnoredIssue,
  MaterialDto,
  MaterialInput,
  MaterialRuleDto,
  MaterialRuleInput,
  OrganizationSettings,
  ProjectCostSettings,
  FloorLinkDto,
  FloorLinkInput,
  InstallationDto,
  DrawingPatchInput,
  ClientInput,
  FloorDto,
  FloorSettingsInput,
  PlanUrlDto,
  ProjectCreateInput,
  ProjectDto,
  ProjectUpdateInput,
} from '@electro/shared';

/** Typed REST client for mutations and one-off reads. Lists/details in pages use `httpResource` directly. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);

  // Clients
  createClient(input: ClientInput) {
    return firstValueFrom(this.http.post<ClientDto>('/api/clients', input));
  }
  updateClient(id: string, input: ClientInput) {
    return firstValueFrom(this.http.put<ClientDto>(`/api/clients/${id}`, input));
  }
  deleteClient(id: string) {
    return firstValueFrom(this.http.delete<void>(`/api/clients/${id}`));
  }

  // Projects
  getProject(id: string) {
    return firstValueFrom(this.http.get<ProjectDto>(`/api/projects/${id}`));
  }
  createProject(input: ProjectCreateInput) {
    return firstValueFrom(this.http.post<ProjectDto>('/api/projects', input));
  }
  updateProject(id: string, input: ProjectUpdateInput) {
    return firstValueFrom(this.http.patch<ProjectDto>(`/api/projects/${id}`, input));
  }
  deleteProject(id: string) {
    return firstValueFrom(this.http.delete<void>(`/api/projects/${id}`));
  }

  // Floors
  getFloor(id: string) {
    return firstValueFrom(this.http.get<FloorDto>(`/api/floors/${id}`));
  }
  createFloor(projectId: string, name: string) {
    return firstValueFrom(this.http.post<FloorDto>(`/api/projects/${projectId}/floors`, { name }));
  }
  renameFloor(id: string, name: string) {
    return firstValueFrom(this.http.patch<FloorDto>(`/api/floors/${id}/name`, { name }));
  }
  reorderFloors(projectId: string, floorIds: string[]) {
    return firstValueFrom(this.http.put<FloorDto[]>(`/api/projects/${projectId}/floors/order`, { floorIds }));
  }
  deleteFloor(id: string) {
    return firstValueFrom(this.http.delete<void>(`/api/floors/${id}`));
  }
  updateFloorSettings(id: string, input: FloorSettingsInput) {
    return firstValueFrom(this.http.patch<FloorDto>(`/api/floors/${id}/settings`, input));
  }
  getDrawing(floorId: string) {
    return firstValueFrom(this.http.get<DrawingDto>(`/api/floors/${floorId}/drawing`));
  }
  patchDrawing(floorId: string, input: DrawingPatchInput) {
    return firstValueFrom(this.http.patch<{ revision: number }>(`/api/floors/${floorId}/drawing`, input));
  }
  // Installation (circuits, boards, floor connections)
  getInstallation(projectId: string) {
    return firstValueFrom(this.http.get<InstallationDto>(`/api/projects/${projectId}/installation`));
  }
  createCircuit(projectId: string, input: CircuitInput) {
    return firstValueFrom(this.http.post<CircuitDto>(`/api/projects/${projectId}/circuits`, input));
  }
  updateCircuit(id: string, input: Partial<CircuitInput>) {
    return firstValueFrom(this.http.patch<CircuitDto>(`/api/circuits/${id}`, input));
  }
  deleteCircuit(id: string) {
    return firstValueFrom(this.http.delete<void>(`/api/circuits/${id}`));
  }
  createLink(projectId: string, input: FloorLinkInput) {
    return firstValueFrom(this.http.post<FloorLinkDto>(`/api/projects/${projectId}/links`, input));
  }
  updateLink(id: string, input: Partial<FloorLinkInput>) {
    return firstValueFrom(this.http.patch<FloorLinkDto>(`/api/links/${id}`, input));
  }
  deleteLink(id: string) {
    return firstValueFrom(this.http.delete<void>(`/api/links/${id}`));
  }
  setElectricalProfile(projectId: string, profile: ElectricalProfile) {
    return firstValueFrom(this.http.put<ElectricalProfile>(`/api/projects/${projectId}/electrical-profile`, profile));
  }
  setCostSettings(projectId: string, settings: ProjectCostSettings) {
    return firstValueFrom(this.http.put<ProjectCostSettings>(`/api/projects/${projectId}/cost-settings`, settings));
  }
  ignoreIssue(projectId: string, issueId: string) {
    return firstValueFrom(this.http.post<IgnoredIssue[]>(`/api/projects/${projectId}/ignored-issues`, { issueId }));
  }
  restoreIssue(projectId: string, issueId: string) {
    return firstValueFrom(this.http.post<IgnoredIssue[]>(`/api/projects/${projectId}/ignored-issues/restore`, { issueId }));
  }
  /** One DXF file per floor (or a ZIP of all floors when `floorId` is omitted). */
  exportDxf(projectId: string, floorId?: string) {
    const q = floorId ? `?floorId=${encodeURIComponent(floorId)}` : '';
    return firstValueFrom(this.http.get(`/api/projects/${projectId}/dxf${q}`, { responseType: 'blob' }));
  }
  setFloorHeights(floorId: string, input: FloorHeightsInput) {
    return firstValueFrom(this.http.put<FloorHeightsInput>(`/api/floors/${floorId}/heights`, input));
  }
  // Company settings, price list and material rules
  getOrganizationSettings() {
    return firstValueFrom(this.http.get<OrganizationSettings>('/api/organization/settings'));
  }
  setOrganizationSettings(settings: OrganizationSettings) {
    return firstValueFrom(this.http.put<OrganizationSettings>('/api/organization/settings', settings));
  }
  createMaterial(input: MaterialInput) {
    return firstValueFrom(this.http.post<MaterialDto>('/api/materials', input));
  }
  updateMaterial(id: string, input: Partial<MaterialInput>) {
    return firstValueFrom(this.http.patch<MaterialDto>(`/api/materials/${id}`, input));
  }
  deleteMaterial(id: string) {
    return firstValueFrom(this.http.delete<void>(`/api/materials/${id}`));
  }
  importMaterials(csv: string, apply: boolean) {
    return firstValueFrom(
      this.http.post<{ created: number; updated: number; errors: { line: number; message: string }[]; applied: boolean }>(
        '/api/materials/import',
        { csv, apply },
      ),
    );
  }
  addExampleMaterials() {
    return firstValueFrom(this.http.post<{ added: number }>('/api/materials/examples', {}));
  }
  createRule(input: MaterialRuleInput) {
    return firstValueFrom(this.http.post<MaterialRuleDto>('/api/material-rules', input));
  }
  updateRule(id: string, input: Partial<MaterialRuleInput>) {
    return firstValueFrom(this.http.patch<MaterialRuleDto>(`/api/material-rules/${id}`, input));
  }
  deleteRule(id: string) {
    return firstValueFrom(this.http.delete<void>(`/api/material-rules/${id}`));
  }
  /** Generates a PDF on the server and returns it as a Blob. */
  exportPdf(projectId: string, options: ExportOptions) {
    return firstValueFrom(this.http.post(`/api/projects/${projectId}/exports`, options, { responseType: 'blob' }));
  }
  planUrl(id: string) {
    return firstValueFrom(this.http.get<PlanUrlDto>(`/api/floors/${id}/plan-url`));
  }

  /** Uploads a plan PDF; emits upload progress 0–1, then completes with the updated floor. */
  uploadPlan(floorId: string, file: File): Observable<{ progress: number; floor?: FloorDto }> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http
      .put<FloorDto>(`/api/floors/${floorId}/plan`, body, { reportProgress: true, observe: 'events' })
      .pipe(
        filter((e) => e.type === HttpEventType.UploadProgress || e.type === HttpEventType.Response),
        map((e) => {
          if (e.type === HttpEventType.Response) return { progress: 1, floor: e.body ?? undefined };
          return { progress: e.total ? e.loaded / e.total : 0 };
        }),
      );
  }
}
