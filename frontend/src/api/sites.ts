import request from "@/utils/request";

export type SiteEnvironment = "phpstudy" | "baota" | "remote";

export interface ManagedSite {
  id: number;
  name: string;
  code: string;
  environment: SiteEnvironment;
  rootPath: string;
  dbPath: string;
  publicBaseUrl: string;
  youtubeChannelId: string;
  enabled: boolean;
  isDefault: boolean;
  notes: string;
  configPath?: string;
  createTime?: string;
  updateTime?: string;
}

export type SaveManagedSite = Omit<ManagedSite, "id" | "createTime" | "updateTime" | "configPath">;

export interface SiteTestResult {
  ok: boolean;
  siteId: number;
  name: string;
  checks: {
    rootExists: boolean;
    dbExists: boolean;
    dbInsideData: boolean;
    publicBaseUrl: boolean;
    configFileExists: boolean;
  };
  configPath?: string;
  message: string;
}

export interface DiscoveredSite extends SaveManagedSite {
  existingSiteId: number;
  databaseCount: number;
}

export interface SiteDiscoveryResult {
  parentPath: string;
  scannedDirectories: number;
  foundSites: number;
  newSites: number;
  candidates: DiscoveredSite[];
}

export interface SitesCheckResult {
  total: number;
  passed: number;
  failed: number;
  results: SiteTestResult[];
}

export interface SharedSiteSettings {
  youtubeApiKeyConfigured: boolean;
  youtubeApiKeyMasked: string;
}

export interface SiteLanguage {
  acode: string;
  code: string;
  name: string;
}

export interface SiteBusinessProfile {
  siteId: number;
  siteName: string;
  publicBaseUrl: string;
  companyName: string;
  companySubtitle: string;
  logoUrl: string;
  website: string;
  assetBaseUrl: string;
  contactName: string;
  phone: string;
  whatsapp: string;
  wechat: string;
  email: string;
}

export const getSites = () => request.get<ManagedSite[]>("/sites");
export const getCurrentSite = () => request.get<ManagedSite>("/sites/current");
export const getCurrentSiteLanguages = () => request.get<SiteLanguage[]>("/sites/current/languages");
export const getCurrentSiteProfile = () => request.get<SiteBusinessProfile>("/sites/current/profile");
export const createSite = (data: SaveManagedSite) => request.post<ManagedSite>("/sites", data);
export const updateSite = (id: number, data: SaveManagedSite) => request.patch<ManagedSite>(`/sites/${id}`, data);
export const removeSite = (id: number) => request.delete(`/sites/${id}`);
export const setDefaultSite = (id: number) => request.post<ManagedSite>(`/sites/${id}/default`);
export const testSite = (id: number) => request.post<SiteTestResult>(`/sites/${id}/test`);
export const discoverSites = (data: { parentPath: string; environment: SiteEnvironment }) =>
  request.post<SiteDiscoveryResult>("/sites/discover", data);
export const testAllSites = () => request.post<SitesCheckResult>("/sites/check-all");
export const getSharedSiteSettings = () => request.get<SharedSiteSettings>("/sites/shared-settings");
export const saveSharedSiteSettings = (data: { youtubeApiKey?: string }) =>
  request.post<SharedSiteSettings>("/sites/shared-settings", data);
