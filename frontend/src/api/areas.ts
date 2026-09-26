import request from "@/utils/request";

export interface Area {
  id: number;
  acode: string;
  name: string;
  domain: string;
  is_default: string;
  create_user: string;
  update_user: string;
  create_time: string;
  update_time: string;
}

export interface AreaListResult {
  data: Area[];
  total: number;
  page: number;
  limit: number;
}

export interface SaveAreaPayload {
  acode: string;
  name: string;
  domain?: string;
}

export const getAreas = (params: { search?: string; page?: number; limit?: number } = {}) =>
  request.get<AreaListResult>("/areas", { params });

export const getArea = (id: number) => request.get<Area>(`/areas/${id}`);

export const createArea = (data: SaveAreaPayload) => request.post<Area>("/areas", data);

export const updateArea = (id: number, data: { name?: string; domain?: string }) =>
  request.put<Area>(`/areas/${id}`, data);

export const removeArea = (id: number) => request.delete<{ message: string }>(`/areas/${id}`);

export const batchDeleteAreas = (ids: number[]) =>
  request.post<{ message: string }>("/areas/batch-delete", { ids });

export const setDefaultArea = (id: number) =>
  request.post<{ message: string }>(`/areas/${id}/default`);

export interface AreaProgramPreview {
  siteId: number; siteName: string; revision: string; file: string; localPath: string;
  needsRepair: boolean; canSync: boolean; target: string;
}
export interface AreaProgramResult {
  siteId: number; localChanged: boolean; message: string; file: string;
  online?: { ok: boolean; changed?: boolean; message: string };
}
export const previewAreaProgram = (siteId: number) =>
  request.get<AreaProgramPreview>('/areas/program-repair', { params: { siteId } });
export const repairAreaProgram = (data: { siteId: number; revision: string; syncRemote: boolean }) =>
  request.post<AreaProgramResult>('/areas/program-repair', data, { timeout: 180000 });
