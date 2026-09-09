import request from '@/utils/request';

export type ResourceStatus = 'candidate' | 'referenced' | 'review' | 'protected';
export interface ResourceEntry {
  path: string; kind: 'image' | 'directory' | 'other'; size: number; modifiedAt: string;
  status: ResourceStatus; reason: string;
}
export interface ResourceScan {
  id: string; siteId: number; siteName: string; root: string; createdAt: string;
  entries: ResourceEntry[]; referenceSources: number; graceDays: number;
}
export interface ResourceBatch {
  id: string; createdAt: string; error?: string;
  entries: { path: string; state: string; recoverable: boolean }[];
}
const base = '/sites/current/resources';
export const scanResources = () => request.post<ResourceScan>(`${base}/scan`, {}, { timeout: 180000 });
export const cleanResources = (scanId: string, paths: string[]) => request.post<{ id: string; moved: number; errors: string[] }>(`${base}/clean`, { scanId, paths }, { timeout: 180000 });
export const getResourceHistory = () => request.get<ResourceBatch[]>(`${base}/history`);
export const restoreResources = (id: string) => request.post<{ restored: number; errors: string[] }>(`${base}/restore/${id}`, {}, { timeout: 180000 });
