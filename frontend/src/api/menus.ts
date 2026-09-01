import request from "@/utils/request";

export type MenuItem = {
  id: number | string;
  name: string;
  parentId: number;
  publisher: string;
  href: string;
  code: string;
  urlName: string;
  model: string;
  listTemplate: string;
  detailTemplate: string;
  icon: string[];
  show: boolean;
  orderNum: number;
  createTime?: string;
  updateTime?: string;
};

export type MenuForm = Omit<MenuItem, "id" | "createTime" | "updateTime">;

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
  results: Array<{ acode: string; translated: number; skipped: number }>;
};

export type MenuPushAllResult = {
  msg: string;
  backupPath: string;
  total: number;
  updated: number;
  skipped: number;
  skippedFields: string[];
};

export const getAll = () => {
  return request<MenuItem[]>({ method: "GET", url: "/menus" });
};

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

export const translateMenusFromChinese = (model: string) => {
  return request<MenuTranslateResult>({
    method: "POST",
    url: "/menus/translate-all",
    data: { model },
    timeout: 180000,
  });
};

export const syncAllMenusToPboot = () => {
  return request<MenuPushAllResult>({
    method: "POST",
    url: "/menus/pboot-sync-all",
    timeout: 180000,
  });
};
