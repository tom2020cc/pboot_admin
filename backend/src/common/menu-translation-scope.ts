import { BadRequestException } from '@nestjs/common';
import { Menu } from '../menu/entities/menu.entity';

type MenuLite = Pick<Menu, 'id' | 'parentId' | 'code' | 'urlName' | 'href' | 'name' | 'model'>;

export type MenuTranslationScope = {
  targetMenu: MenuLite;
  sourceMenu: MenuLite;
  sourceMenuIds: number[];
};

const getMenuLang = (menu: MenuLite) => {
  const match = String(menu.code || '').match(/^pboot:([^:]+):/);
  return match?.[1] || '';
};

// 内容语言码与 PbootCMS 栏目语言码(acode)只在中文上不同（zh-CN ↔ cn），其余一致。
// 栏目 code 形如 pboot:cn:330，getMenuLang 返回的是 acode（cn/en/es/fr/ru/ar/pt），
// 因此把传入的目标语言统一归一到 acode 再做比较，避免中文(zh-CN)被误判为与栏目语言不匹配。
const toMenuLangCode = (lang: string) => {
  const value = String(lang || '').trim();
  return value === 'zh-CN' || value === 'zh' ? 'cn' : value;
};

const getMenuCodeNumber = (menu: MenuLite) => {
  const match = String(menu.code || '').match(/:(\d+)$/);
  return Number(match?.[1] || Number.MAX_SAFE_INTEGER);
};

const menuModelMatches = (menu: MenuLite, model: string) => {
  const currentModel = String(menu.model || '');
  if (currentModel === model) return true;
  // Some PbootCMS news columns can be imported with an empty model in Chinese,
  // while other languages correctly keep model=2. Keep them usable as Chinese sources.
  return model === '2' && getMenuLang(menu) === 'cn' && currentModel === '';
};

const normalizeMenuSlug = (menu: MenuLite) => {
  return String(menu.urlName || menu.href || menu.name || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/^(cn|en|es|fr|ru|ar|pt)[-_/]+/i, '')
    .toLowerCase();
};

const sortMenus = (rows: MenuLite[]) => {
  return [...rows].sort((left, right) => {
    const codeDiff = getMenuCodeNumber(left) - getMenuCodeNumber(right);
    return codeDiff || Number(left.id) - Number(right.id);
  });
};

const findEquivalentChild = (
  menus: MenuLite[],
  targetChild: MenuLite,
  targetParent: MenuLite,
  sourceParent: MenuLite,
  targetLang: string,
  model: string,
) => {
  const sourceSiblings = sortMenus(
    menus.filter(
      (item) =>
        getMenuLang(item) === 'cn' &&
        menuModelMatches(item, model) &&
        Number(item.parentId || 0) === Number(sourceParent.id),
    ),
  );
  const exact = sourceSiblings.find((item) => normalizeMenuSlug(item) === normalizeMenuSlug(targetChild));
  if (exact) return exact;

  const targetSiblings = sortMenus(
    menus.filter(
      (item) =>
        getMenuLang(item) === targetLang &&
        menuModelMatches(item, model) &&
        Number(item.parentId || 0) === Number(targetParent.id),
    ),
  );
  const siblingIndex = targetSiblings.findIndex((item) => Number(item.id) === Number(targetChild.id));
  return siblingIndex >= 0 ? sourceSiblings[siblingIndex] : undefined;
};

export const resolveChineseMenuScope = (
  menus: MenuLite[],
  targetMenuId: number,
  targetLang: string,
  model: string,
): MenuTranslationScope => {
  // 归一到栏目语言码(acode)空间，兼容调用方传入内容码(zh-CN)或 acode(cn)
  const menuLang = toMenuLangCode(targetLang);
  const targetMenu = menus.find((item) => Number(item.id) === Number(targetMenuId));
  if (!targetMenu) throw new BadRequestException('The selected target menu no longer exists.');
  if (!menuModelMatches(targetMenu, model)) {
    throw new BadRequestException('The selected menu does not belong to the current content module.');
  }
  if (getMenuLang(targetMenu) !== menuLang) {
    throw new BadRequestException('The selected menu language does not match the current target language.');
  }

  const lineage: MenuLite[] = [];
  let cursor: MenuLite | undefined = targetMenu;
  const visited = new Set<number>();
  while (cursor && !visited.has(Number(cursor.id))) {
    visited.add(Number(cursor.id));
    lineage.unshift(cursor);
    cursor = menus.find((item) => Number(item.id) === Number(cursor?.parentId || 0));
  }

  const targetRoot = lineage[0];
  const sourceRoots = sortMenus(
    menus.filter(
      (item) =>
        getMenuLang(item) === 'cn' &&
        menuModelMatches(item, model) &&
        Number(item.parentId || 0) === 0,
    ),
  );
  const exactRoot = sourceRoots.find((item) => normalizeMenuSlug(item) === normalizeMenuSlug(targetRoot));
  const targetRoots = sortMenus(
    menus.filter(
      (item) =>
        getMenuLang(item) === menuLang &&
        menuModelMatches(item, model) &&
        Number(item.parentId || 0) === 0,
    ),
  );
  const targetRootIndex = targetRoots.findIndex((item) => Number(item.id) === Number(targetRoot.id));
  let sourceCursor = exactRoot || (targetRootIndex >= 0 ? sourceRoots[targetRootIndex] : undefined);
  if (!sourceCursor) {
    throw new BadRequestException('No matching Chinese source menu was found for the selected target menu.');
  }

  let targetCursor = targetRoot;
  for (const targetChild of lineage.slice(1)) {
    const nextSource = findEquivalentChild(
      menus,
      targetChild,
      targetCursor,
      sourceCursor,
      menuLang,
      model,
    );
    if (!nextSource) {
      throw new BadRequestException(
        `No matching Chinese source menu was found for "${targetChild.name}".`,
      );
    }
    targetCursor = targetChild;
    sourceCursor = nextSource;
  }

  const sourceMenuIds = new Set<number>([Number(sourceCursor.id)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const menu of menus) {
      const id = Number(menu.id);
      if (
        !sourceMenuIds.has(id) &&
        getMenuLang(menu) === 'cn' &&
        menuModelMatches(menu, model) &&
        sourceMenuIds.has(Number(menu.parentId || 0))
      ) {
        sourceMenuIds.add(id);
        changed = true;
      }
    }
  }

  return {
    targetMenu,
    sourceMenu: sourceCursor,
    sourceMenuIds: [...sourceMenuIds],
  };
};
