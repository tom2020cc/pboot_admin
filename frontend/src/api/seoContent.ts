import request from '@/utils/request';
export interface SeoConfig { industry: string; brand: string; instructions: string; keywords: string[]; model: string; menuId: number; feeds: string[]; intervalHours: number; dailyLimit: number; }
export interface SeoDraft { title: string; subtitle: string; keywords: string; summary: string; content: string; }
export interface SeoSource { id: number; title: string; url: string; notes: string; verified: boolean; publishedAt: string; }
export interface SeoJob { id: string; siteId: number; kind: string; status: string; snapshot: SeoConfig & { source?: { title: string; url: string; notes: string } }; draft: SeoDraft | null; revision: number; createdAt: string; scheduledAt: string; error: string; tokens: number; newsId: number; attempts: number; checks: string[]; }
export interface SeoState {
  plan: { siteId: number; enabled: boolean; revision: number; config: SeoConfig; nextRunAt: string };
  control: { paused: boolean; heartbeat: string };
  models: { value: string; label: string; available: boolean; operational?: boolean }[];
  menus: { id: number; name: string }[]; sources: SeoSource[]; jobs: SeoJob[];
}
export const seoRequest = <T = unknown>(siteId: number, path = '', method = 'GET', data?: unknown) => request.request<T>({
  url: `/seo-content${path}`, method, data, headers: { 'X-Pboot-Site-Id': String(siteId) },
});
