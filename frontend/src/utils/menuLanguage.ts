import type { MenuItem } from "@/api/menus";

export const contentLangToMenuLang = (lang: string) => (lang === "zh-CN" ? "cn" : lang);

export const getMenuLang = (menu: Pick<MenuItem, "code">) => {
  const match = String(menu.code || "").match(/^pboot:([^:]+):/);
  return match?.[1] || "";
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
  return menus.filter((item) => getMenuLang(item) === menuLang);
};

export const filterMenusByContentLangAndModel = (menus: MenuItem[], lang: string, model: string) => {
  return filterMenusByContentLang(menus, lang).filter((item) => menuModelMatches(item, model));
};

export const getMenuSlug = (menu: Pick<MenuItem, "urlName" | "href" | "name">) => {
  return String(menu.urlName || menu.href || menu.name || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^(cn|en|es|fr|ru|ar|pt)[-_/]+/i, "")
    .toLowerCase();
};

const getMenuCodeNumber = (menu: Pick<MenuItem, "code" | "id">) => {
  const match = String(menu.code || "").match(/:(\d+)$/);
  return Number(match?.[1] || Number.MAX_SAFE_INTEGER);
};

const sortMenus = (menus: MenuItem[]) => {
  return [...menus].sort((left, right) => {
    const codeDiff = getMenuCodeNumber(left) - getMenuCodeNumber(right);
    return codeDiff || Number(left.id) - Number(right.id);
  });
};

const getMenuLineage = (menus: MenuItem[], source: MenuItem) => {
  const lineage: MenuItem[] = [];
  const visited = new Set<number>();
  let cursor: MenuItem | undefined = source;

  while (cursor && !visited.has(Number(cursor.id))) {
    visited.add(Number(cursor.id));
    lineage.unshift(cursor);
    cursor = menus.find((item) => Number(item.id) === Number(cursor?.parentId || 0));
  }

  return lineage;
};

const findEquivalentChild = (
  menus: MenuItem[],
  sourceChild: MenuItem,
  sourceParent: MenuItem,
  targetParent: MenuItem,
  sourceLang: string,
  targetLang: string,
  model: string,
) => {
  const targetSiblings = sortMenus(
    menus.filter(
      (item) =>
        getMenuLang(item) === targetLang &&
        menuModelMatches(item, model) &&
        Number(item.parentId || 0) === Number(targetParent.id),
    ),
  );
  const exact = targetSiblings.find((item) => getMenuSlug(item) === getMenuSlug(sourceChild));
  if (exact) return exact;

  const sourceSiblings = sortMenus(
    menus.filter(
      (item) =>
        getMenuLang(item) === sourceLang &&
        menuModelMatches(item, model) &&
        Number(item.parentId || 0) === Number(sourceParent.id),
    ),
  );
  const siblingIndex = sourceSiblings.findIndex((item) => Number(item.id) === Number(sourceChild.id));
  return siblingIndex >= 0 ? targetSiblings[siblingIndex] : undefined;
};

export const findEquivalentMenuForLang = (menus: MenuItem[], sourceMenuId: number | string, lang: string, model: string) => {
  const source = menus.find((item) => Number(item.id) === Number(sourceMenuId));
  if (!source) return undefined;

  const targetLang = contentLangToMenuLang(lang);
  const sourceLang = getMenuLang(source);
  const currentMenus = filterMenusByContentLangAndModel(menus, lang, model);
  if (sourceLang === targetLang) {
    return currentMenus.find((item) => Number(item.id) === Number(sourceMenuId));
  }

  const lineage = getMenuLineage(menus, source);
  const sourceRoot = lineage[0];
  const targetRoots = sortMenus(
    currentMenus.filter((item) => Number(item.parentId || 0) === 0),
  );
  const exactRoot = targetRoots.find((item) => getMenuSlug(item) === getMenuSlug(sourceRoot));
  const sourceRoots = sortMenus(
    menus.filter(
      (item) =>
        getMenuLang(item) === sourceLang &&
        menuModelMatches(item, model) &&
        Number(item.parentId || 0) === 0,
    ),
  );
  const rootIndex = sourceRoots.findIndex((item) => Number(item.id) === Number(sourceRoot.id));
  let targetCursor = exactRoot || (rootIndex >= 0 ? targetRoots[rootIndex] : undefined);
  if (!targetCursor) return undefined;

  let sourceCursor = sourceRoot;
  for (const sourceChild of lineage.slice(1)) {
    const nextTarget = findEquivalentChild(
      menus,
      sourceChild,
      sourceCursor,
      targetCursor,
      sourceLang,
      targetLang,
      model,
    );
    if (!nextTarget) return undefined;
    sourceCursor = sourceChild;
    targetCursor = nextTarget;
  }

  return targetCursor;
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
