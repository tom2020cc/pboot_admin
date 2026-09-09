import { BadRequestException } from '@nestjs/common';
import { Menu } from '../menu/entities/menu.entity';
import { menuLanguage, resolveMenuSources } from '../menu/menu-relations';

type MenuLite = Pick<Menu, 'id' | 'parentId' | 'code' | 'urlName' | 'href' | 'name' | 'model'>
  & Partial<Pick<Menu, 'siteId' | 'sourceMenuId' | 'pendingDelete'>>;

export type MenuTranslationScope = {
  targetMenu: MenuLite;
  sourceMenu: MenuLite;
  sourceMenuIds: number[];
};

const menuModelMatches = (menu: MenuLite, model: string) => String(menu.model || '') === model
  || (model === '2' && menuLanguage(menu) === 'cn' && !menu.model);

export const resolveChineseMenuScope = (
  menus: MenuLite[], targetMenuId: number, targetLang: string, model: string,
): MenuTranslationScope => {
  const menuLang = ['zh-CN', 'zh'].includes(targetLang) ? 'cn' : targetLang;
  const targetMenu = menus.find(item => Number(item.id) === Number(targetMenuId) && !item.pendingDelete);
  if (!targetMenu) throw new BadRequestException('The selected target menu no longer exists.');
  if (!menuModelMatches(targetMenu, model)) throw new BadRequestException('The selected menu does not belong to the current content module.');
  if (menuLanguage(targetMenu, menus) !== menuLang) throw new BadRequestException('The selected menu language does not match the current target language.');
  const sources = resolveMenuSources(menus);
  const sourceMenu = menus.find(item => Number(item.id) === sources.get(Number(targetMenu.id)) && !item.pendingDelete);
  if (!sourceMenu || !menuModelMatches(sourceMenu, model)) {
    throw new BadRequestException('No matching Chinese source menu was found. 请先在菜单管理确认中文来源。');
  }
  const sourceMenuIds = new Set<number>([Number(sourceMenu.id)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const menu of menus) {
      const id = Number(menu.id);
      if (!menu.pendingDelete && !sourceMenuIds.has(id) && menuLanguage(menu, menus) === 'cn'
        && menuModelMatches(menu, model) && sourceMenuIds.has(Number(menu.parentId || 0))) {
        sourceMenuIds.add(id);
        changed = true;
      }
    }
  }
  return { targetMenu, sourceMenu, sourceMenuIds: [...sourceMenuIds] };
};
