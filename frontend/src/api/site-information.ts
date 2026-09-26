import request from '@/utils/request';

export type InformationSection = 'site' | 'company';
export interface InformationData { site: Record<string, string>; company: Record<string, string> }
export interface InformationField {
  section: InformationSection; key: string; label: string;
  translate?: boolean; type?: 'textarea' | 'image' | 'theme'; maxLength: number;
}
export interface InformationProfile {
  language: string; data: InformationData; revision: string;
  exists: { site: boolean; company: boolean }; hasDraft: boolean; pending: boolean;
  pbChanged: boolean; sourceChanged: boolean; translatedModel: string; translatedAt: string;
}
export interface InformationResponse {
  siteId: number; siteName: string; publicBaseUrl: string; fields: InformationField[]; themes: string[];
  languages: { code: string; name: string }[]; profiles: InformationProfile[]; warnings?: string[];
  usedModel?: string; fallbackUsed?: boolean;
  environment?: string; canSyncOnline?: boolean; onlineTarget?: string; onlineTargetRevision?: string;
}
export interface InformationModel {
  value: string; label: string; displayLabel?: string; provider: string; available: boolean;
  operational?: boolean; recommended: boolean; priority: number; purpose: string;
  quotaStatus: 'public-free' | 'check-console' | 'unconfigured'; quotaText: string; healthStatus?: 'ok' | 'failed' | 'untested';
}
export interface InformationSetup {
  token: string; siteId: number; siteName: string;
  items: { language: string; name: string; theme: string; domain: string; boundDomain: string;
    createSite: boolean; createCompany: boolean; needsChange: boolean; problems: string[];
    changes: { field: string; label: string; before: string; after: string }[] }[];
}
const config = (siteId: number) => ({ headers: { 'X-Pboot-Site-Id': String(siteId) }, timeout: 30000 });
export const getInformationSetup = (siteId: number) => request.get<InformationSetup>('/site-information/setup', config(siteId));
export const setupInformation = (siteId: number, token: string, languages: string[]) =>
  request.post<InformationResponse>('/site-information/setup', { token, languages }, config(siteId));
export const getInformation = (siteId: number) => request.get<InformationResponse>('/site-information', config(siteId));
export const getInformationModels = () => request.get<InformationModel[]>('/site-information/models');
export const saveInformation = (siteId: number, profile: InformationProfile) =>
  request.post<InformationResponse>('/site-information/save', { language: profile.language, revision: profile.revision, data: profile.data }, config(siteId));
export const importInformation = (siteId: number, profile: InformationProfile) =>
  request.post<InformationResponse>('/site-information/import', { language: profile.language, revision: profile.revision }, config(siteId));
export const translateInformation = (siteId: number, profile: InformationProfile, sourceRevision: string, model: string) =>
  request.post<InformationResponse>('/site-information/translate', { language: profile.language, revision: profile.revision, sourceRevision, model }, { ...config(siteId), timeout: 180000 });
export const syncInformation = (siteId: number, profiles: InformationProfile[]) =>
  request.post<InformationResponse>('/site-information/sync', { items: profiles.map(({ language, revision }) => ({ language, revision })) }, config(siteId));
export interface OnlineInformationResult {
  siteId: number; target: string; languages: string[]; imageCount: number; verifiedAt: string; warnings: string[];
}
export const syncInformationOnline = (siteId: number, profiles: InformationProfile[], targetRevision: string) =>
  request.post<OnlineInformationResult>('/site-information/sync-online', { siteId, targetRevision,
    items: profiles.map(({ language, revision }) => ({ language, revision })) }, { ...config(siteId), timeout: 240000 });
