import request from '@/utils/request';
export interface SeoConfig { industry: string; brand: string; instructions: string; keywords: string[]; model: string; menuId: number; feeds: string[]; intervalHours: number; dailyLimit: number; searchEnabled: boolean; dailyCollectLimit: number; searchProvider: 'deepseek' | 'brave'; researchModel: string; maxOutputTokens: number; dailySearchLimit: number; knowledge: string; productIds: number[]; }
export interface SeoArticle { id: number; title: string; menuId: number; urlName: string; updateTime: string; }
export interface EditorialRules { version: string; rules: { id: string; title: string; text: string }[]; }
export interface SeoQuality { issues: string[]; warnings: string[]; stats: { bodyChars: number; headings: number; matchedKeywords: string[]; missingKeywords: string[]; comparedCount: number }; similar: { id: string; kind: 'news' | 'job'; title: string; score: number; exactTitle: boolean }[]; }
export interface SeoDraft { title: string; subtitle: string; keywords: string; summary: string; content: string; }
export interface SeoSource { id: number; title: string; url: string; notes: string; verified: boolean; publishedAt: string; }
export interface SeoJob { id: string; siteId: number; kind: string; status: string; snapshot: SeoConfig & { source?: { title: string; url: string; notes: string }; editorial?: EditorialRules; previous?: { id: number; urlName: string; draft: SeoDraft } }; draft: SeoDraft | null; revision: number; createdAt: string; scheduledAt: string; error: string; tokens: number; newsId: number; attempts: number; checks: string[]; }
export interface SeoState {
  plan: { siteId: number; enabled: boolean; revision: number; config: SeoConfig; nextRunAt: string };
  control: { paused: boolean; heartbeat: string };
  integrations: { searchConfigured: boolean; workerConfigured: boolean; deepseekConfigured: boolean; braveConfigured: boolean };
  usage: { generateToday: number; collectToday: number; searchToday: number };
  editorial: EditorialRules;
  articles: SeoArticle[];
  products: { id: number; title: string }[];
  models: { value: string; label: string; available: boolean; operational?: boolean }[];
  menus: { id: number; name: string }[]; sources: SeoSource[]; jobs: SeoJob[];
}
export const seoRequest = <T = unknown>(siteId: number, path = '', method = 'GET', data?: unknown) => request.request<T>({
  url: `/seo-content${path}`, method, data, headers: { 'X-Pboot-Site-Id': String(siteId) },
});
