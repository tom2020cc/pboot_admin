import type { MenuItem } from "@/api/menus";

export const contentLangToMenuLang = (lang: string) => (lang === "zh-CN" ? "cn" : lang);

export const getMenuLang = (menu: Pick<MenuItem, "code" | "acode">) => {
  const match = String(menu.code || "").match(/^pboot:([^:]+):/);
  return match?.[1] || menu.acode || "cn";
};

const menuModelMatches = (menu: Pick<MenuItem, "code" | "model">, model: string) => {
  const currentModel = String(menu.model || "");
  if (currentModel === model) return true;
  // Some PbootCMS news columns can be imported with an empty model in Chinese,
  // while other languages correctly keep model=2. Keep them usable as Chinese sources.
  return model === "2" && getMenuLang(menu) === "cn" && currentModel === "";
};

export const filterMenusByContentLang = (menus: MenuItem[], lang: string) => {
  const menuLang = contentLangToMenuLang(lang);
  return menus.filter((item) => !item.pendingDelete && getMenuLang(item) === menuLang);
};

export const filterMenusByContentLangAndModel = (menus: MenuItem[], lang: string, model: string) => {
  return filterMenusByContentLang(menus, lang).filter((item) => menuModelMatches(item, model));
};

export const getMenuSlug = (menu: Pick<MenuItem, "urlName" | "href" | "name">) => {
  return String(menu.urlName || menu.href || menu.name || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^(cn|en|es|fr|ru|ar|pt|id|tr|vi)[-_/]+/i, "")
    .toLowerCase();
};

const getMenuLineage = (menus: MenuItem[], source: MenuItem) => {
  const lineage: MenuItem[] = [];
  const visited = new Set<number>();
  let cursor: MenuItem | undefined = source;
  while (cursor) {
    if (visited.has(Number(cursor.id))) return [];
    visited.add(Number(cursor.id));
    lineage.unshift(cursor);
    if (!cursor.parentId) return lineage;
    cursor = menus.find(item => Number(item.id) === Number(cursor?.parentId));
  }
  return [];
};

export const findEquivalentMenuForLang = (menus: MenuItem[], sourceMenuId: number | string, lang: string, model: string) => {
  const source = menus.find(item => Number(item.id) === Number(sourceMenuId) && !item.pendingDelete);
  if (!source) return undefined;
  const targetLang = contentLangToMenuLang(lang);
  const current = filterMenusByContentLangAndModel(menus, lang, model);
  if (getMenuLang(source) === targetLang) return current.find(item => Number(item.id) === Number(source.id));
  const sourceId = getMenuLang(source) === 'cn' ? Number(source.id) : source.sourceMenuId;
  if (sourceId) {
    const linked = current.filter(item => targetLang === 'cn' ? Number(item.id) === sourceId : item.sourceMenuId === sourceId);
    if (linked.length === 1) return linked[0];
    return undefined;
  }
  // Older API payloads may not contain source IDs; never match by sibling position.
  const path = getMenuLineage(menus, source).map(getMenuSlug).join('/');
  if (!path) return undefined;
  const matches = current.filter(item => !item.sourceMenuId && getMenuLineage(menus, item).map(getMenuSlug).join('/') === path);
  return matches.length === 1 ? matches[0] : undefined;
};

export const formatMenuPathForLang = (menus: MenuItem[], sourceMenuId: number | string, lang: string, model: string) => {
  const sameLangMenus = filterMenusByContentLang(menus, lang);
  const modelMenus = sameLangMenus.filter((item) => String(item.model || "") === model);
  const item =
    modelMenus.find((menu) => Number(menu.id) === Number(sourceMenuId)) ||
    sameLangMenus.find((menu) => Number(menu.id) === Number(sourceMenuId)) ||
    findEquivalentMenuForLang(menus, sourceMenuId, lang, model);
  if (!item) return `栏目 #${sourceMenuId}`;

  const parent = sameLangMenus.find((menu) => Number(menu.id) === Number(item.parentId));
  return Number(item.parentId) === 0 ? item.name : `${parent?.name || "未知栏目"} / ${item.name}`;
};
