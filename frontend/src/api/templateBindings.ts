import request from '@/utils/request';

export type BindingLanguage = 'cn' | 'en';
export interface BindingReference { file: string; lang: BindingLanguage; tag: string; attribute: string; scode: string; line: number; }
export interface BindingMenu { id: number; name: string; parentId: string | number; lang: BindingLanguage; scode: string; model: string; }
export interface LanguageBinding { sourceScode: string; menuId: number | null; targetScode: string | null; issue: string; references: BindingReference[]; }
export interface BindingGroup { id: string; label: string; cn: LanguageBinding | null; en: LanguageBinding | null; }
export interface TemplateBindings {
  siteId: number; siteName: string; revision: string; templateVersion: string;
  fileCount: number; warnings: string[]; groups: BindingGroup[]; menus: BindingMenu[];
}
export interface BindingRow { id: string; cnMenuId: number | null; enMenuId: number | null; }
export interface BindingPayload { revision: string; templateVersion: string; bindings: BindingRow[]; }
export interface BindingPreview {
  previewId: string; siteName: string; changedFiles: number; changedReferences: number;
  files: { file: string; changes: (BindingReference & { before: string; after: string })[] }[];
}
const base = '/sites/current/template-bindings';
export const getTemplateBindings = () => request.get<TemplateBindings>(base);
export const saveTemplateBindings = (data: BindingPayload) => request.post<TemplateBindings>(`${base}/save`, data);
export const previewTemplateBindings = (data: BindingPayload) => request.post<BindingPreview>(`${base}/preview`, data);
export const applyTemplateBindings = (previewId: string) => request.post<{ changedFiles: number; changedReferences: number; backupPath: string; message: string }>(`${base}/apply`, { previewId });
