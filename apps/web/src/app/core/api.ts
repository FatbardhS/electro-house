import { HttpClient, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { filter, firstValueFrom, map, type Observable } from 'rxjs';
import type {
  ClientDto,
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
