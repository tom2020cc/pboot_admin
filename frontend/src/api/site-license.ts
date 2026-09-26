import request from '@/utils/request';

export type LicenseEnvironment = 'phpstudy' | 'baota';
export interface LicenseProfile { domains: string[]; codes: string; phone: string }
export interface SiteLicense {
  siteId: number; siteName: string; activeEnvironment: LicenseEnvironment | null; publicDomain: string;
  profiles: Record<LicenseEnvironment, LicenseProfile>;
  live: { codes: string; phone: string }; revision: string; warnings?: string[];
  onlineSync?: { ok: boolean; message: string; verifiedAt?: string };
  canSyncRemote?: boolean;
}
const headers = (siteId: number) => ({ 'X-Pboot-Site-Id': String(siteId) });
export const readSiteLicense = (siteId: number) => request.get<SiteLicense>('/sites/current/system-license', { headers: headers(siteId) });
export const saveSiteLicense = (siteId: number, payload: LicenseProfile & { environment: LicenseEnvironment; revision: string; apply: boolean; syncRemote?: boolean }) =>
  request.post<SiteLicense>('/sites/current/system-license', { ...payload, siteId }, { headers: headers(siteId), timeout: payload.syncRemote ? 180000 : 10000 });
