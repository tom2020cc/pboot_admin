import request from "@/utils/request";

export type MenuItem = {
  id: number | string;
  name: string;
  parentId: number;
  publisher: string;
  href: string;
  code: string;
  acode?: string;
  sourceMenuId?: number;
  pbootSyncPending?: boolean;
  pendingDelete?: boolean;
  translationNeedsUpdate?: boolean;
  urlName: string;
  model: string;
  listTemplate: string;
  detailTemplate: string;
  icon: string[];
  thumbnail?: string | null;
  largeImage?: string | null;
  seoTitle?: string | null;
  seoKeywords?: string | null;
  seoDescription?: string | null;
  show: boolean;
  orderNum: number;
  createTime?: string;
  updateTime?: string;
};

export type MenuForm = Omit<MenuItem, "id" | "createTime" | "updateTime" | "acode" | "pbootSyncPending" | "pendingDelete" | "translationNeedsUpdate">;

export type MenuSyncResult = {
  msg: string;
  total: number;
  created: number;
  updated: number;
  removed: number;
  localBackupPath: string;
  skippedFields: string[];
  synced: Array<{
    acode: string;
    scode: string;
    name: string;
    parentId: number;
    action: "created" | "updated";
  }>;
};

export type MenuPushResult = {
  msg: string;
  backupPath: string;
  acode: string;
  scode: string;
  name: string;
  skippedFields: string[];
};

export type MenuTranslationModel = {
  value: string;
  label: string;
  displayLabel?: string;
  provider: string;
  available: boolean;
  operational?: boolean;
  healthStatus?: "ok" | "failed" | "untested";
  healthElapsedMs?: number | null;
  healthMessage?: string;
  healthTestedAt?: string;
  priority?: number;
  recommended?: boolean;
  purpose?: string;
  quotaStatus?: "public-free" | "check-console" | "unconfigured";
  quotaText?: string;
  quotaUrl?: string;
  remainingQuota?: number | null;
};

export type MenuTranslateResult = {
  msg: string;
  model: string;
  source: string;
  sourceCount: number;
  localBackupPath: string;
  note: string;
  results: Array<{
    acode: string;
    translated: number;
    created: number;
    updated: number;
    skipped: number;
    model: string;
  }>;
  failures: Array<{ acode: string; message: string }>;
};

export type MenuPushAllResult = {
  deleted: number;
  msg: string;
  backupPath: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  skippedFields: string[];
};

export const getAll = () => {
  return request<MenuItem[]>({ method: "GET", url: "/menus" });
};

export const getPbootMenuModels = () => request<Array<{ value: string; label: string }>>({ method: 'GET', url: '/menus/pboot-models' });
export const previewMenuDelete = (id: string | number) => request<{
  canDelete: boolean; reason: string;
  items: Array<{ id: string; name: string; acode: string }>;
}>({ method: 'GET', url: `/menus/${id}/delete-preview` });
export const restoreMenu = (id: string | number) => request({ method: 'POST', url: `/menus/${id}/restore` });

export const create = (postObj: MenuForm) => {
  return request<MenuItem>({ method: "POST", url: "/menus", data: postObj });
};

export const remove = (id: string | number) => {
  return request({ method: "DELETE", url: `/menus/${id}` });
};

export const getMenuById = (id: string | number) => {
  return request<MenuItem>({ method: "GET", url: `/menus/${id}` });
};

export const update = (id: string | number, postObj: MenuForm) => {
  return request<MenuItem>({ method: "PATCH", url: `/menus/${id}`, data: postObj });
};

export const syncPbootMenus = () => {
  return request<MenuSyncResult>({
    method: "POST",
    url: "/menus/pboot-sync",
    timeout: 180000,
  });
};

export const syncMenuToPboot = (id: string | number) => {
  return request<MenuPushResult>({
    method: "POST",
    url: `/menus/${id}/pboot-sync`,
    timeout: 60000,
  });
};

export const getMenuTranslationModels = () => {
  return request<MenuTranslationModel[]>({ method: "GET", url: "/menus/translation-models" });
};

export type MenuSeoDraft = {
  model: string;
  lang: 'cn';
  menuId?: string;
  name: string;
  parentName?: string;
  seoTitle?: string;
  seoKeywords?: string;
  seoDescription?: string;
};

export const optimizeMenuSeoDraft = (data: MenuSeoDraft) => request<{
  model: string;
  lang: 'cn';
  seoTitle: string;
  seoKeywords: string;
  seoDescription: string;
}>({ method: 'POST', url: '/menus/optimize-seo', data, timeout: 180000 });

export const translateMenusFromChinese = (model: string, targetAcodes?: string[]) => {
  return request<MenuTranslateResult>({
    method: "POST",
    url: "/menus/translate-all",
    data: { model, targetAcodes },
    timeout: 1800000,
  });
};

export const translateMenuFromChinese = (id: string | number, model: string, targetAcodes: string[]) =>
  request<MenuTranslateResult>({ method: 'POST', url: `/menus/${id}/translate`, data: { model, targetAcodes }, timeout: 600000 });

export const syncAllMenusToPboot = () => {
  return request<MenuPushAllResult>({
    method: "POST",
    url: "/menus/pboot-sync-all",
    timeout: 180000,
  });
};
